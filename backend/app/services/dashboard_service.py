"""
DashboardService - Phase 3
==========================
Business logic for all dashboard aggregation. Routes call this; it calls `DashboardRepository` (all SQL).

Scope (the tenant predicate every query carries)
------------------------------------------------
    SUPER_ADMIN          -> global (org_ids=None, hier_path=None)
    partner / support    -> (org_ids = the caller's organisation subtree, hier_path = the caller's legacy hierarchy path)
    END_USER             -> no partner dashboard at all (403)
The caller never chooses an organisation, except SUPER_ADMIN on `/organisations/{id}`. The pair (org_ids, hier_path)
is the same "org subtree OR path prefix" rule the database's own row-level security applies to `pumps`, so an explicit
predicate and RLS cannot disagree, and an empty scope returns nothing.

Timezone
--------
"Today" is a calendar day in `settings.DASHBOARD_TIMEZONE` (default Asia/Kolkata), converted to UTC instants in
`app.core.dashboard_time`. The browser's clock and the server's local date are never used.

Caching
-------
No new infrastructure. The three assembled dashboards are cached for `DASHBOARD_CACHE_TTL_SECONDS` (default 30) in the
existing `cache_service` (Redis when configured, in-process otherwise), keyed by a hash of the scope and the filters,
so two callers with different scope can never share an entry. `generated_at` is when the numbers were computed, not when
the response was sent. Completed days of runtime come from the `daily_summary` rollup; today is counted live.
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.config import settings
from app.core.dashboard_time import local_today, today_start_utc
from app.core.errors import AppError
from app.core.metrics import metrics_collector
from app.core.roles import UserRole, normalize_role
from app.models import Organisation, User
from app.repositories.dashboard_repository import DashboardRepository
from app.services.cache_service import cache_service

logger = logging.getLogger("agripump.dashboard.service")

Scope = Tuple[Optional[List[str]], Optional[str]]
CACHE_VERSION = "v1"


def _settings_int(name: str, default: int) -> int:
    return int(getattr(settings, name, default))


DASHBOARD_CACHE_TTL = _settings_int("DASHBOARD_CACHE_TTL_SECONDS", 30)
TOP_DEVICES_LIMIT = _settings_int("DASHBOARD_TOP_DEVICES_LIMIT", 10)
FAULT_WINDOW_DAYS = _settings_int("DASHBOARD_FAULT_WINDOW_DAYS", 30)


def scope_hier_path(role: UserRole, hierarchy_path: Any) -> Optional[str]:
    """The legacy hierarchy path a caller may be scoped by, or None.

    Accounts created before organisations existed are scoped only by this path (`/SA/DEALER/...`). The bare root
    (`/SA`) belongs to the super admin, so a partner whose path is just the root is refused instead of being handed
    the whole fleet. Shared by the HTTP service and the WebSocket hub so both apply the identical rule."""
    if role == UserRole.SUPER_ADMIN or not isinstance(hierarchy_path, str):
        return None
    segments = [s for s in hierarchy_path.split("/") if s]
    return "/" + "/".join(segments) if len(segments) >= 2 else None


def _denied(reason: str) -> AppError:
    return AppError(
        code="DASHBOARD_ACCESS_DENIED", message_key="errors.dashboardAccessDenied", status_code=403,
        detail=f"DASHBOARD_ACCESS_DENIED: {reason}",
    )


class DashboardService:
    """
    Aggregates dashboard data with mandatory scoping. `get_*` methods return plain dicts/lists (never ORM objects),
    so routes can serialise them directly.
    """

    def __init__(self, db: Session, user: User):
        self.db = db
        self.user = user
        self.repo = DashboardRepository(db)
        self._role = normalize_role(user.role)

    # ------------------------------------------------------------------ scope
    def _resolve_org_ids(self) -> Optional[List[str]]:
        """None -> global (SUPER_ADMIN); [...] -> the caller's organisation subtree; [] -> no organisation (deny)."""
        if self._role == UserRole.SUPER_ADMIN:
            return None
        org = getattr(self.user, "organisation", None)
        if not org and self.user.org_id:
            org = self.db.query(Organisation).filter(Organisation.id == self.user.org_id).first()
        if not org or not org.path:
            return []
        return self.repo.resolve_subtree_org_ids(str(org.path))

    def _hier_path(self) -> Optional[str]:
        """The caller's legacy hierarchy path, when it is a real partner path (`/SA/DEALER...`, never the bare root).

        Accounts created before organisations existed are scoped only by this path. The bare `/SA` root belongs to
        the super admin, so a partner whose path is the root is refused rather than handed the whole fleet."""
        return scope_hier_path(self._role, getattr(self.user, "hierarchy_path", None))

    def _resolve_scope(self) -> Scope:
        return self._resolve_org_ids(), self._hier_path()

    def _require_global(self) -> None:
        if self._role != UserRole.SUPER_ADMIN:
            raise _denied("the global dashboard requires SUPER_ADMIN")

    def _require_subtree(self) -> None:
        if self._role == UserRole.END_USER:
            raise _denied("end users do not have access to the partner dashboard")

    # -------------------------------------------------------------- caching
    @staticmethod
    def _scope_key(scope: Scope, extra: Dict[str, Any]) -> str:
        org_ids, hp = scope
        blob = json.dumps(
            {"o": None if org_ids is None else sorted(org_ids), "h": hp, "x": extra}, sort_keys=True, default=str
        )
        return hashlib.sha1(blob.encode()).hexdigest()

    def _cached(self, kind: str, scope: Scope, extra: Dict[str, Any], build: Callable[[], Dict[str, Any]]):
        """(payload, cache_hit). The payload is computed at most once per TTL per scope+filters."""
        ttl = DASHBOARD_CACHE_TTL
        key = f"dash:{CACHE_VERSION}:{kind}:{self._scope_key(scope, extra)}"
        if ttl > 0:
            raw = cache_service.get(key)
            if raw:
                try:
                    metrics_collector.incr(f"dashboard.cache.hit.{kind}")
                    return json.loads(raw), True
                except ValueError:
                    cache_service.delete(key)
        t0 = time.monotonic()
        data = build()
        metrics_collector.observe(f"dashboard.query_ms.{kind}", (time.monotonic() - t0) * 1000)
        metrics_collector.incr(f"dashboard.cache.miss.{kind}")
        if ttl > 0:
            cache_service.set(key, json.dumps(data, default=str), ex=ttl)
        return data, False

    def _wrap(self, payload: Dict[str, Any], hit: bool, filters: Dict[str, Any]) -> Dict[str, Any]:
        """Add per-response metadata to a (possibly cached) aggregate."""
        out = dict(payload)
        last = out.get("last_data_update")
        stale_after = _settings_int("DASHBOARD_STALE_AFTER_SECONDS", 900)
        age = None
        stale = True  # nothing has ever reported => there is nothing fresh to show
        if last:
            age = max(0, int((datetime.now(timezone.utc) - datetime.fromisoformat(last)).total_seconds()))
            stale = age > stale_after
        out["freshness"] = {
            "generated_at": out.get("generated_at"), "last_data_update": last,
            "data_age_seconds": age, "stale": stale, "stale_after_seconds": stale_after,
        }
        out["cache"] = {"hit": hit, "ttl_seconds": DASHBOARD_CACHE_TTL}
        out["filters"] = {k: v for k, v in filters.items() if v is not None}
        out["timezone"] = settings.DASHBOARD_TIMEZONE
        return out

    @staticmethod
    def _filters(state: Optional[str] = None, firmware_version: Optional[str] = None) -> Dict[str, Any]:
        f: Dict[str, Any] = {}
        if state:
            f["state"] = state.upper()
        if firmware_version:
            f["firmware_version"] = firmware_version
        return f

    # -------------------------------------------- individual aggregators (reusable)
    def get_device_state_summary(self, org_ids, hier_path=None, filters=None) -> Dict[str, Any]:
        return self.repo.get_device_state_summary(org_ids, hier_path=hier_path, filters=filters)

    def get_connectivity_summary(self, org_ids, hier_path=None, filters=None) -> Dict[str, int]:
        return self.repo.get_connectivity_summary(org_ids, settings.OFFLINE_AFTER_SECONDS, hier_path=hier_path,
                                                  filters=filters)

    def get_fault_summary(self, org_ids, hier_path=None, filters=None) -> Dict[str, Any]:
        return self.repo.get_active_fault_summary(org_ids, hier_path=hier_path, filters=filters)

    def get_faults_today(self, org_ids, hier_path=None, filters=None) -> int:
        return self.repo.get_faults_today(org_ids, today_start_utc(), hier_path=hier_path, filters=filters)

    def get_top_faulting_devices(
        self, org_ids, limit: int = TOP_DEVICES_LIMIT, offset: int = 0, window_days: int = FAULT_WINDOW_DAYS,
        hier_path=None, filters=None,
    ) -> Dict[str, Any]:
        since = datetime.now(timezone.utc) - timedelta(days=window_days)
        items, total = self.repo.get_top_faulting_page(org_ids, since, limit=limit, offset=offset, hier_path=hier_path,
                                                       filters=filters)
        return {"items": items, "total": total, "limit": limit, "offset": offset, "window_days": window_days}

    def get_firmware_distribution(self, org_ids, hier_path=None, filters=None) -> List[Dict[str, Any]]:
        return self.repo.get_firmware_distribution(org_ids, hier_path=hier_path, filters=filters)

    def get_connectivity_map(self, org_ids, hier_path=None, filters=None) -> List[Dict[str, Any]]:
        return self.repo.get_connectivity_map(org_ids, settings.OFFLINE_AFTER_SECONDS, hier_path=hier_path,
                                              filters=filters)

    def get_runtime_summary(self, org_ids, period_days: Optional[int] = None, hier_path=None) -> Dict[str, Any]:
        period_days = period_days or _settings_int("DASHBOARD_RUNTIME_PERIOD_DAYS", 7)
        return self.repo.get_runtime_summary(org_ids, local_today(), period_days=period_days, hier_path=hier_path,
                                             today_start_utc=today_start_utc())

    def get_warranty_expiring(self, org_ids, within_days: int = 30, hier_path=None) -> int:
        return self.repo.get_warranty_expiring_count(org_ids, within_days, hier_path=hier_path, today=local_today())

    def get_subscription_expiring(self, org_ids, within_days: int = 30, hier_path=None) -> int:
        return self.repo.get_subscription_expiring_count(org_ids, within_days, hier_path=hier_path)

    # ---------------------------------------------------------- main dashboards
    def get_global_dashboard(self, state: Optional[str] = None, firmware_version: Optional[str] = None,
                             window_days: int = FAULT_WINDOW_DAYS) -> Dict[str, Any]:
        """SUPER_ADMIN only: the whole fleet."""
        self._require_global()
        flt = self._filters(state, firmware_version)
        scope: Scope = (None, None)

        def build() -> Dict[str, Any]:
            top = self.get_top_faulting_devices(None, window_days=window_days, filters=flt)
            last = self.repo.get_last_telemetry_update(None)
            return {
                "scope": {"type": "GLOBAL", "organisation_id": None},
                "devices": self.get_device_state_summary(None, filters=flt),
                "connectivity": self.get_connectivity_summary(None, filters=flt),
                "faults": self.get_fault_summary(None, filters=flt),
                "top_faulting_devices": top["items"],
                "top_faulting_devices_meta": {"total": top["total"], "limit": top["limit"],
                                              "window_days": top["window_days"]},
                "firmware_distribution": self.get_firmware_distribution(None, filters=flt),
                "connectivity_map": self.get_connectivity_map(None, filters=flt),
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "last_data_update": last.isoformat() if last else None,
            }

        payload, hit = self._cached("global", scope, {**flt, "w": window_days}, build)
        return self._wrap(payload, hit, {**flt, "window_days": window_days})

    def _partner_payload(self, org_ids, hier_path, scope_info: Dict[str, Any], flt: Dict[str, Any],
                         window_days: int) -> Dict[str, Any]:
        top = self.get_top_faulting_devices(org_ids, window_days=window_days, hier_path=hier_path, filters=flt)
        last = self.repo.get_last_telemetry_update(org_ids, hier_path=hier_path)
        return {
            "scope": scope_info,
            "devices": self.get_device_state_summary(org_ids, hier_path, flt),
            "connectivity": self.get_connectivity_summary(org_ids, hier_path, flt),
            "faults_today": self.get_faults_today(org_ids, hier_path, flt),
            "faults": self.get_fault_summary(org_ids, hier_path, flt),
            "top_faulting_devices": top["items"],
            "top_faulting_devices_meta": {"total": top["total"], "limit": top["limit"],
                                          "window_days": top["window_days"]},
            "firmware_distribution": self.get_firmware_distribution(org_ids, hier_path, flt),
            "runtime": self.get_runtime_summary(org_ids, hier_path=hier_path),
            "warranty_expiring_soon": self.get_warranty_expiring(org_ids, hier_path=hier_path),
            "subscription_expiring_soon": self.get_subscription_expiring(org_ids, hier_path=hier_path),
            "connectivity_map": self.get_connectivity_map(org_ids, hier_path, flt),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "last_data_update": last.isoformat() if last else None,
        }

    def get_subtree_dashboard(self, state: Optional[str] = None, firmware_version: Optional[str] = None,
                              window_days: int = FAULT_WINDOW_DAYS) -> Dict[str, Any]:
        """PANEL_MANUFACTURER / DISTRIBUTOR / DEALER / SUPPORT_ENGINEER: the caller's own subtree."""
        self._require_subtree()
        flt = self._filters(state, firmware_version)
        org_ids, hier_path = self._resolve_scope()
        org = getattr(self.user, "organisation", None)
        if not org and self.user.org_id:
            org = self.db.query(Organisation).filter(Organisation.id == self.user.org_id).first()
        scope_info = {
            "type": "SUBTREE",
            "organisation_id": str(org.id) if org else None,
            "organisation_name": org.name if org else None,
        }
        payload, hit = self._cached(
            "subtree", (org_ids, hier_path), {**flt, "w": window_days},
            lambda: self._partner_payload(org_ids, hier_path, scope_info, flt, window_days),
        )
        return self._wrap(payload, hit, {**flt, "window_days": window_days})

    def get_org_dashboard(self, target_org_id: str, state: Optional[str] = None,
                          firmware_version: Optional[str] = None, window_days: int = FAULT_WINDOW_DAYS
                          ) -> Dict[str, Any]:
        """SUPER_ADMIN inspecting one organisation's subtree. Partners can never pick an organisation."""
        self._require_global()
        try:
            target = self.db.query(Organisation).filter(Organisation.id == target_org_id).first()
        except Exception:  # a malformed id is "not found", not a 500
            self.db.rollback()
            target = None
        if not target:
            raise AppError(code="ORGANISATION_NOT_FOUND", message_key="errors.organisationNotFound",
                           status_code=404, detail="ORGANISATION_NOT_FOUND")
        org_ids = self.repo.resolve_subtree_org_ids(str(target.path)) if target.path else []
        flt = self._filters(state, firmware_version)
        scope_info = {"type": "ORG", "organisation_id": str(target.id), "organisation_name": target.name}
        # A super admin looking at one organisation is scoped by its org tree only (no legacy path).
        payload, hit = self._cached(
            "org", (org_ids, None), {**flt, "w": window_days},
            lambda: self._partner_payload(org_ids, None, scope_info, flt, window_days),
        )
        return self._wrap(payload, hit, {**flt, "window_days": window_days})

    # ------------------------------------------------- detail lists (paginated)
    def get_connectivity_only(self, state: Optional[str] = None, firmware_version: Optional[str] = None
                              ) -> Dict[str, Any]:
        self._require_subtree()
        org_ids, hp = self._resolve_scope()
        return self.get_connectivity_summary(org_ids, hp, self._filters(state, firmware_version))

    def get_firmware_only(self, state: Optional[str] = None) -> List[Dict[str, Any]]:
        self._require_subtree()
        org_ids, hp = self._resolve_scope()
        return self.get_firmware_distribution(org_ids, hp, self._filters(state))

    def get_offline_devices(self, limit: int = 50, offset: int = 0, state: Optional[str] = None,
                            firmware_version: Optional[str] = None) -> Dict[str, Any]:
        self._require_subtree()
        org_ids, hp = self._resolve_scope()
        flt = self._filters(state, firmware_version)
        items = self.repo.get_offline_device_list(org_ids, settings.OFFLINE_AFTER_SECONDS, limit=limit, offset=offset,
                                                  hier_path=hp, filters=flt)
        total = self.repo.get_offline_device_count(org_ids, settings.OFFLINE_AFTER_SECONDS, hier_path=hp, filters=flt)
        return {"items": items, "total": total, "limit": limit, "offset": offset}

    def get_top_faulting_devices_list(self, limit: int = 10, offset: int = 0, window_days: int = FAULT_WINDOW_DAYS,
                                      state: Optional[str] = None, firmware_version: Optional[str] = None
                                      ) -> Dict[str, Any]:
        self._require_subtree()
        org_ids, hp = self._resolve_scope()
        return self.get_top_faulting_devices(org_ids, limit=limit, offset=offset, window_days=window_days,
                                             hier_path=hp, filters=self._filters(state, firmware_version))

    def get_faults_list(self, limit: int = 20, offset: int = 0, fault_code: Optional[int] = None,
                        state: Optional[str] = None, firmware_version: Optional[str] = None) -> Dict[str, Any]:
        self._require_subtree()
        org_ids, hp = self._resolve_scope()
        flt = self._filters(state, firmware_version)
        if fault_code is not None:
            flt["fault_code"] = fault_code
        return {
            "summary": self.get_fault_summary(org_ids, hp, {k: v for k, v in flt.items() if k != "fault_code"}),
            "faults_today": self.get_faults_today(org_ids, hp, {k: v for k, v in flt.items() if k != "fault_code"}),
            "items": self.repo.get_recent_faults(org_ids, limit=limit, offset=offset, hier_path=hp, filters=flt),
            "total": self.repo.get_recent_faults_count(org_ids, hier_path=hp, filters=flt),
            "limit": limit, "offset": offset,
        }

    def get_warranty_expiring_list(self, within_days: int = 30, limit: int = 50, offset: int = 0) -> Dict[str, Any]:
        self._require_subtree()
        org_ids, hp = self._resolve_scope()
        today = local_today()
        return {
            "items": self.repo.get_warranty_expiring_list(org_ids, within_days, limit, offset, hier_path=hp,
                                                          today=today),
            "total": self.repo.get_warranty_expiring_count(org_ids, within_days, hier_path=hp, today=today),
            "within_days": within_days, "limit": limit, "offset": offset,
        }

    def get_subscription_expiring_list(self, within_days: int = 30, limit: int = 50, offset: int = 0
                                       ) -> Dict[str, Any]:
        self._require_subtree()
        org_ids, hp = self._resolve_scope()
        return {
            "items": self.repo.get_subscription_expiring_list(org_ids, within_days, limit, offset, hier_path=hp),
            "total": self.repo.get_subscription_expiring_count(org_ids, within_days, hier_path=hp),
            "within_days": within_days, "limit": limit, "offset": offset,
        }
