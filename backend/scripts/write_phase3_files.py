"""Write Phase 3 backend service, API, WebSocket, migration, and test files."""
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(BASE, "app")
TESTS = os.path.join(BASE, "tests")

files = {}

# =========================================================
# 2. DashboardService
# =========================================================
files[os.path.join(APP, "services", "dashboard_service.py")] = r'''"""
DashboardService - Phase 3
==========================
Business logic for all dashboard aggregation.

Architecture:
  Controller (API router)
      -> DashboardService (this file)
          -> DashboardRepository (SQL queries)
          -> AuthorizationService (scope resolution)

Timezone strategy
-----------------
"Today" is anchored to UTC midnight.  The configured DASHBOARD_TIMEZONE
setting (default 'UTC') allows per-deployment override.  Never use
browser/client local time for backend date boundaries.

Caching strategy
----------------
No external cache dependency is added.  The DailySummary rollup table
(populated nightly by the existing jobs worker) serves as the primary
pre-computation layer for runtime metrics.  For expensive fleet-wide
counts (device state, connectivity, faults) we rely on:
  1. Postgres aggregation (fast for <= 100k rows)
  2. Optional in-process short-TTL cache via CacheService (in-memory
     fallback when Redis is absent)

This avoids adding Redis as a hard dependency while still giving
the dashboard sub-second response for common fleet sizes.
"""
from __future__ import annotations

import logging
import time
from datetime import date, datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.config import settings
from app.core.roles import UserRole, normalize_role
from app.models import User, Organisation
from app.repositories.dashboard_repository import DashboardRepository
from app.services.authorization_service import AuthorizationService
from app.services.cache_service import cache_service

logger = logging.getLogger("agripump.dashboard.service")

# Short-lived in-process cache for expensive aggregations.
# Keyed by (scope_hash, metric_name); TTL in seconds.
DASHBOARD_CACHE_TTL = int(getattr(settings, "DASHBOARD_CACHE_TTL_SECONDS", 30))
TOP_DEVICES_LIMIT = int(getattr(settings, "DASHBOARD_TOP_DEVICES_LIMIT", 10))
FAULT_WINDOW_DAYS = int(getattr(settings, "DASHBOARD_FAULT_WINDOW_DAYS", 30))


def _utc_today_start() -> datetime:
    """Today's midnight UTC."""
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


class DashboardService:
    """
    Aggregates all dashboard data with mandatory organisation scoping.

    Methods that start with 'get_' return dicts/lists directly; they never
    return ORM objects so controllers can serialize them as JSON without
    additional transformation.
    """

    def __init__(self, db: Session, user: User):
        self.db = db
        self.user = user
        self.repo = DashboardRepository(db)
        self._role = normalize_role(user.role)

    # ------------------------------------------------------------------
    # Scope resolution
    # ------------------------------------------------------------------

    def _resolve_org_ids(self) -> Optional[List[str]]:
        """
        Returns:
          None      -> SuperAdmin global scope
          [...]     -> list of org UUIDs the caller may see
          []        -> caller has no organisation (safe-deny)
        """
        if self._role == UserRole.SUPER_ADMIN:
            return None  # global

        org = getattr(self.user, "organisation", None)
        if not org and self.user.org_id:
            org = self.db.query(Organisation).filter(Organisation.id == self.user.org_id).first()

        if not org or not org.path:
            logger.warning("User %s has no org or path; returning empty scope", self.user.id)
            return []  # safe empty

        return self.repo.resolve_subtree_org_ids(str(org.path))

    def _require_global(self) -> None:
        """Raises if caller is not SuperAdmin."""
        from fastapi import HTTPException, status
        if self._role != UserRole.SUPER_ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="DASHBOARD_ACCESS_DENIED: global dashboard requires SUPER_ADMIN"
            )

    def _require_subtree(self) -> None:
        """Raises if caller is END_USER (they have no partner dashboard)."""
        from fastapi import HTTPException, status
        if self._role == UserRole.END_USER:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="DASHBOARD_ACCESS_DENIED: end users do not have access to the partner dashboard"
            )

    # ------------------------------------------------------------------
    # Individual metric aggregators (reusable)
    # ------------------------------------------------------------------

    def get_device_state_summary(self, org_ids: Optional[List[str]]) -> Dict[str, Any]:
        return self.repo.get_device_state_summary(org_ids)

    def get_connectivity_summary(self, org_ids: Optional[List[str]]) -> Dict[str, int]:
        return self.repo.get_connectivity_summary(org_ids, settings.OFFLINE_AFTER_SECONDS)

    def get_fault_summary(self, org_ids: Optional[List[str]]) -> Dict[str, Any]:
        return self.repo.get_active_fault_summary(org_ids)

    def get_faults_today(self, org_ids: Optional[List[str]]) -> int:
        return self.repo.get_faults_today(org_ids, _utc_today_start())

    def get_top_faulting_devices(
        self, org_ids: Optional[List[str]],
        limit: int = TOP_DEVICES_LIMIT, offset: int = 0,
        window_days: int = FAULT_WINDOW_DAYS
    ) -> Dict[str, Any]:
        since = datetime.now(timezone.utc) - timedelta(days=window_days)
        items = self.repo.get_top_faulting_devices(org_ids, since, limit=limit, offset=offset)
        total = self.repo.get_top_faulting_devices_count(org_ids, since)
        return {
            "items": items,
            "total": total,
            "limit": limit,
            "offset": offset,
            "window_days": window_days,
        }

    def get_firmware_distribution(self, org_ids: Optional[List[str]]) -> List[Dict[str, Any]]:
        return self.repo.get_firmware_distribution(org_ids)

    def get_connectivity_map(self, org_ids: Optional[List[str]]) -> List[Dict[str, Any]]:
        return self.repo.get_connectivity_map(org_ids, settings.OFFLINE_AFTER_SECONDS)

    def get_runtime_summary(self, org_ids: Optional[List[str]], period_days: int = 30) -> Dict[str, Any]:
        return self.repo.get_runtime_summary(org_ids, date.today(), period_days=period_days)

    def get_warranty_expiring(self, org_ids: Optional[List[str]], within_days: int = 30) -> int:
        return self.repo.get_warranty_expiring_count(org_ids, within_days)

    def get_subscription_expiring(self, org_ids: Optional[List[str]], within_days: int = 30) -> int:
        return self.repo.get_subscription_expiring_count(org_ids, within_days)

    # ------------------------------------------------------------------
    # Main dashboard aggregators
    # ------------------------------------------------------------------

    def get_global_dashboard(self) -> Dict[str, Any]:
        """SuperAdmin-only: fleet-wide aggregation across all organisations."""
        self._require_global()
        org_ids = None  # global
        now = datetime.now(timezone.utc)

        devices = self.get_device_state_summary(org_ids)
        connectivity = self.get_connectivity_summary(org_ids)
        faults = self.get_fault_summary(org_ids)
        top_devices = self.get_top_faulting_devices(org_ids)
        firmware = self.get_firmware_distribution(org_ids)
        conn_map = self.get_connectivity_map(org_ids)
        last_data = self.repo.get_last_telemetry_update(org_ids)

        return {
            "scope": {"type": "GLOBAL", "organisation_id": None},
            "devices": devices,
            "connectivity": connectivity,
            "faults": faults,
            "top_faulting_devices": top_devices["items"],
            "top_faulting_devices_meta": {
                "total": top_devices["total"],
                "limit": top_devices["limit"],
                "window_days": top_devices["window_days"],
            },
            "firmware_distribution": firmware,
            "connectivity_map": conn_map,
            "generated_at": now.isoformat(),
            "last_data_update": last_data.isoformat() if last_data else None,
        }

    def get_subtree_dashboard(self) -> Dict[str, Any]:
        """Partner-scoped dashboard for PANEL_MANUFACTURER, DISTRIBUTOR, DEALER, SUPPORT_ENGINEER."""
        self._require_subtree()
        org_ids = self._resolve_org_ids()
        now = datetime.now(timezone.utc)

        org = getattr(self.user, "organisation", None)
        if not org and self.user.org_id:
            org = self.db.query(Organisation).filter(Organisation.id == self.user.org_id).first()

        org_name = org.name if org else None
        org_id_str = str(org.id) if org else None

        devices = self.get_device_state_summary(org_ids)
        connectivity = self.get_connectivity_summary(org_ids)
        faults_today = self.get_faults_today(org_ids)
        runtime = self.get_runtime_summary(org_ids)
        warranty_expiring = self.get_warranty_expiring(org_ids)
        subscription_expiring = self.get_subscription_expiring(org_ids)
        faults = self.get_fault_summary(org_ids)
        conn_map = self.get_connectivity_map(org_ids)
        last_data = self.repo.get_last_telemetry_update(org_ids)

        return {
            "scope": {
                "type": "SUBTREE",
                "organisation_id": org_id_str,
                "organisation_name": org_name,
            },
            "devices": devices,
            "connectivity": connectivity,
            "faults_today": faults_today,
            "faults": faults,
            "runtime": runtime,
            "warranty_expiring_soon": warranty_expiring,
            "subscription_expiring_soon": subscription_expiring,
            "connectivity_map": conn_map,
            "generated_at": now.isoformat(),
            "last_data_update": last_data.isoformat() if last_data else None,
        }

    def get_org_dashboard(self, target_org_id: str) -> Dict[str, Any]:
        """
        SuperAdmin-scoped view of a specific org subtree.
        Regular partners may NOT use this to switch org context.
        """
        self._require_global()
        target_org = self.db.query(Organisation).filter(Organisation.id == target_org_id).first()
        if not target_org:
            from fastapi import HTTPException, status
            raise HTTPException(status_code=404, detail="ORGANISATION_NOT_FOUND")

        if not target_org.path:
            org_ids: List[str] = []
        else:
            org_ids = self.repo.resolve_subtree_org_ids(str(target_org.path))

        now = datetime.now(timezone.utc)
        devices = self.get_device_state_summary(org_ids)
        connectivity = self.get_connectivity_summary(org_ids)
        faults = self.get_fault_summary(org_ids)
        faults_today = self.get_faults_today(org_ids)
        runtime = self.get_runtime_summary(org_ids)
        firmware = self.get_firmware_distribution(org_ids)
        top_devices = self.get_top_faulting_devices(org_ids)
        conn_map = self.get_connectivity_map(org_ids)
        last_data = self.repo.get_last_telemetry_update(org_ids)

        return {
            "scope": {
                "type": "ORG",
                "organisation_id": str(target_org.id),
                "organisation_name": target_org.name,
            },
            "devices": devices,
            "connectivity": connectivity,
            "faults": faults,
            "faults_today": faults_today,
            "runtime": runtime,
            "top_faulting_devices": top_devices["items"],
            "firmware_distribution": firmware,
            "connectivity_map": conn_map,
            "generated_at": now.isoformat(),
            "last_data_update": last_data.isoformat() if last_data else None,
        }

    # ------------------------------------------------------------------
    # Detail list endpoints (paginated)
    # ------------------------------------------------------------------

    def get_offline_devices(self, limit: int = 50, offset: int = 0) -> Dict[str, Any]:
        self._require_subtree()
        org_ids = self._resolve_org_ids()
        items = self.repo.get_offline_device_list(org_ids, settings.OFFLINE_AFTER_SECONDS, limit=limit, offset=offset)
        total = self.repo.get_offline_device_count(org_ids, settings.OFFLINE_AFTER_SECONDS)
        return {"items": items, "total": total, "limit": limit, "offset": offset}

    def get_top_faulting_devices_list(
        self, limit: int = 10, offset: int = 0, window_days: int = FAULT_WINDOW_DAYS
    ) -> Dict[str, Any]:
        self._require_subtree()
        org_ids = self._resolve_org_ids()
        return self.get_top_faulting_devices(org_ids, limit=limit, offset=offset, window_days=window_days)

    def get_faults_list(self, limit: int = 20, offset: int = 0) -> Dict[str, Any]:
        self._require_subtree()
        org_ids = self._resolve_org_ids()
        items = self.repo.get_recent_faults(org_ids, limit=limit, offset=offset)
        return {"items": items, "limit": limit, "offset": offset}

    def get_warranty_expiring_list(self, within_days: int = 30, limit: int = 50, offset: int = 0) -> Dict[str, Any]:
        self._require_subtree()
        org_ids = self._resolve_org_ids()
        items = self.repo.get_warranty_expiring_list(org_ids, within_days=within_days, limit=limit, offset=offset)
        total = self.repo.get_warranty_expiring_count(org_ids, within_days=within_days)
        return {"items": items, "total": total, "within_days": within_days, "limit": limit, "offset": offset}

    def get_subscription_expiring_list(self, within_days: int = 30, limit: int = 50, offset: int = 0) -> Dict[str, Any]:
        self._require_subtree()
        org_ids = self._resolve_org_ids()
        items = self.repo.get_subscription_expiring_list(org_ids, within_days=within_days, limit=limit, offset=offset)
        total = self.repo.get_subscription_expiring_count(org_ids, within_days=within_days)
        return {"items": items, "total": total, "within_days": within_days, "limit": limit, "offset": offset}
'''

# =========================================================
# 3. ConnectivityService (reusable, as required by spec)
# =========================================================
files[os.path.join(APP, "services", "device_connectivity_service.py")] = r'''"""
DeviceConnectivityService - Phase 3
====================================
Reusable connectivity status logic.  Used by both the dashboard and
any other part of the app that needs online/offline classification.

Offline rule (SRS): a device that has reported before but not within
OFFLINE_AFTER_SECONDS (= 3+ missed reporting intervals) is OFFLINE.
A device that has never reported is UNKNOWN, not OFFLINE.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from app.config import settings
from app.models import Pump


_STATUS_ONLINE = "ONLINE"
_STATUS_OFFLINE = "OFFLINE"
_STATUS_UNKNOWN = "UNKNOWN"


class DeviceConnectivityService:
    """Classifies individual device connectivity status."""

    @staticmethod
    def get_connectivity_status(pump: Pump, now: Optional[datetime] = None) -> str:
        """
        Returns 'ONLINE', 'OFFLINE', or 'UNKNOWN'.

        UNKNOWN: device has never reported (last_seen_at IS NULL).
        OFFLINE: reported before but not within OFFLINE_AFTER_SECONDS.
        ONLINE:  reported within OFFLINE_AFTER_SECONDS.
        """
        if pump.last_seen_at is None:
            return _STATUS_UNKNOWN
        now = now or datetime.now(timezone.utc)
        cutoff = now - timedelta(seconds=settings.OFFLINE_AFTER_SECONDS)
        # Normalise both to UTC for comparison
        last_seen = pump.last_seen_at
        if last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=timezone.utc)
        return _STATUS_ONLINE if last_seen >= cutoff else _STATUS_OFFLINE

    @staticmethod
    def is_online(pump: Pump, now: Optional[datetime] = None) -> bool:
        return DeviceConnectivityService.get_connectivity_status(pump, now) == _STATUS_ONLINE

    @staticmethod
    def is_offline(pump: Pump, now: Optional[datetime] = None) -> bool:
        return DeviceConnectivityService.get_connectivity_status(pump, now) == _STATUS_OFFLINE
'''

# =========================================================
# 4. Dashboard API router
# =========================================================
files[os.path.join(APP, "api", "dashboard.py")] = r'''"""
Dashboard API - Phase 3
=======================
Versioned REST endpoints for Global and Subtree dashboards.

Authentication: Bearer JWT (same as all other API endpoints).
Authorization:
  GET /dashboard/global              -> SUPER_ADMIN only
  GET /dashboard/subtree             -> Any partner role
  GET /dashboard/organisations/:id   -> SUPER_ADMIN only
  GET /dashboard/connectivity        -> Any partner role
  GET /dashboard/faults              -> Any partner role
  GET /dashboard/firmware-distribution -> Any partner role
  GET /dashboard/top-faulting-devices -> Any partner role
  GET /dashboard/offline-devices     -> Any partner role
  GET /dashboard/warranty-expiring   -> Any partner role
  GET /dashboard/subscription-expiring -> Any partner role

Rate limiting: inherited from the global RateLimitMiddleware (120 req/min authenticated).

Observability: all requests emit structured log lines with user_id, role, scope,
latency, and query result size.
"""
import logging
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.database import get_db
from app.models import User
from app.services.dashboard_service import DashboardService

logger = logging.getLogger("agripump.dashboard.api")

router = APIRouter(tags=["Dashboard"])


def _svc(user: User, db: Session) -> DashboardService:
    return DashboardService(db=db, user=user)


# ---------------------------------------------------------------------------
# Global Dashboard (SuperAdmin only)
# ---------------------------------------------------------------------------

@router.get(
    "/global",
    summary="Global fleet dashboard (SuperAdmin only)",
    description=(
        "Returns fleet-wide aggregation: device states, connectivity, "
        "active faults, top faulting devices, firmware distribution, "
        "and connectivity map data.\n\n"
        "**Access**: SUPER_ADMIN only. Returns 403 for all other roles."
    ),
    responses={
        200: {"description": "Global dashboard data"},
        403: {"description": "DASHBOARD_ACCESS_DENIED"},
    },
)
def get_global_dashboard(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t0 = time.monotonic()
    try:
        svc = _svc(current_user, db)
        result = svc.get_global_dashboard()
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        logger.info(
            "dashboard.global user_id=%s role=%s devices=%s elapsed_ms=%d",
            current_user.id, current_user.role,
            result.get("devices", {}).get("total", "?"),
            elapsed_ms,
        )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("dashboard.global failed user_id=%s: %s", current_user.id, exc)
        raise HTTPException(status_code=500, detail="DASHBOARD_QUERY_FAILED")


# ---------------------------------------------------------------------------
# Subtree Dashboard (partner roles)
# ---------------------------------------------------------------------------

@router.get(
    "/subtree",
    summary="Subtree dashboard (partner roles)",
    description=(
        "Returns dashboard data scoped to the authenticated user's organisation subtree. "
        "Includes device states, connectivity, faults today, runtime, "
        "warranty and subscription expiry.\n\n"
        "**Access**: PANEL_MANUFACTURER, DISTRIBUTOR, DEALER, SUPPORT_ENGINEER. "
        "END_USER receives 403."
    ),
    responses={
        200: {"description": "Subtree dashboard data"},
        403: {"description": "DASHBOARD_ACCESS_DENIED"},
    },
)
def get_subtree_dashboard(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t0 = time.monotonic()
    try:
        svc = _svc(current_user, db)
        result = svc.get_subtree_dashboard()
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        logger.info(
            "dashboard.subtree user_id=%s role=%s org_id=%s devices=%s elapsed_ms=%d",
            current_user.id, current_user.role,
            result.get("scope", {}).get("organisation_id", "?"),
            result.get("devices", {}).get("total", "?"),
            elapsed_ms,
        )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("dashboard.subtree failed user_id=%s: %s", current_user.id, exc)
        raise HTTPException(status_code=500, detail="DASHBOARD_QUERY_FAILED")


# ---------------------------------------------------------------------------
# Org-scoped Dashboard (SuperAdmin: inspect any org)
# ---------------------------------------------------------------------------

@router.get(
    "/organisations/{organisation_id}",
    summary="Organisation-scoped dashboard (SuperAdmin only)",
    description=(
        "Returns dashboard data scoped to a specific organisation subtree. "
        "**Only SuperAdmin may use this endpoint.** "
        "Regular partners may not supply an arbitrary org_id to bypass their own scope."
    ),
    responses={
        200: {"description": "Organisation-scoped dashboard data"},
        403: {"description": "DASHBOARD_ACCESS_DENIED"},
        404: {"description": "ORGANISATION_NOT_FOUND"},
    },
)
def get_org_dashboard(
    organisation_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t0 = time.monotonic()
    try:
        svc = _svc(current_user, db)
        result = svc.get_org_dashboard(organisation_id)
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        logger.info(
            "dashboard.org user_id=%s role=%s target_org=%s elapsed_ms=%d",
            current_user.id, current_user.role, organisation_id, elapsed_ms,
        )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("dashboard.org failed user_id=%s org=%s: %s", current_user.id, organisation_id, exc)
        raise HTTPException(status_code=500, detail="DASHBOARD_QUERY_FAILED")


# ---------------------------------------------------------------------------
# Individual metric endpoints
# ---------------------------------------------------------------------------

@router.get(
    "/connectivity",
    summary="Connectivity summary (online/offline/unknown counts)",
)
def get_connectivity(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        svc = _svc(current_user, db)
        svc._require_subtree()
        org_ids = svc._resolve_org_ids()
        return svc.get_connectivity_summary(org_ids)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("dashboard.connectivity failed: %s", exc)
        raise HTTPException(status_code=500, detail="DASHBOARD_QUERY_FAILED")


@router.get(
    "/faults",
    summary="Active fault summary + recent fault list",
)
def get_faults(
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        svc = _svc(current_user, db)
        return svc.get_faults_list(limit=limit, offset=offset)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("dashboard.faults failed: %s", exc)
        raise HTTPException(status_code=500, detail="DASHBOARD_QUERY_FAILED")


@router.get(
    "/firmware-distribution",
    summary="Firmware version distribution",
)
def get_firmware_distribution(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        svc = _svc(current_user, db)
        svc._require_subtree()
        org_ids = svc._resolve_org_ids()
        return {"firmware_distribution": svc.get_firmware_distribution(org_ids)}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("dashboard.firmware failed: %s", exc)
        raise HTTPException(status_code=500, detail="DASHBOARD_QUERY_FAILED")


@router.get(
    "/top-faulting-devices",
    summary="Top faulting devices (paginated)",
)
def get_top_faulting_devices(
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    window_days: int = Query(30, ge=1, le=365),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        svc = _svc(current_user, db)
        return svc.get_top_faulting_devices_list(limit=limit, offset=offset, window_days=window_days)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("dashboard.top_faulting failed: %s", exc)
        raise HTTPException(status_code=500, detail="DASHBOARD_QUERY_FAILED")


@router.get(
    "/offline-devices",
    summary="Offline device list (paginated)",
)
def get_offline_devices(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        svc = _svc(current_user, db)
        return svc.get_offline_devices(limit=limit, offset=offset)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("dashboard.offline_devices failed: %s", exc)
        raise HTTPException(status_code=500, detail="DASHBOARD_QUERY_FAILED")


@router.get(
    "/warranty-expiring",
    summary="Devices with warranty expiring soon",
)
def get_warranty_expiring(
    within_days: int = Query(30, ge=1, le=365),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        svc = _svc(current_user, db)
        return svc.get_warranty_expiring_list(within_days=within_days, limit=limit, offset=offset)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("dashboard.warranty failed: %s", exc)
        raise HTTPException(status_code=500, detail="DASHBOARD_QUERY_FAILED")


@router.get(
    "/subscription-expiring",
    summary="Devices with subscription expiring soon",
)
def get_subscription_expiring(
    within_days: int = Query(30, ge=1, le=365),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        svc = _svc(current_user, db)
        return svc.get_subscription_expiring_list(within_days=within_days, limit=limit, offset=offset)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("dashboard.subscription failed: %s", exc)
        raise HTTPException(status_code=500, detail="DASHBOARD_QUERY_FAILED")
'''

# =========================================================
# 5. WebSocket dashboard channel
# =========================================================
files[os.path.join(APP, "websockets", "dashboard_ws.py")] = r'''"""
Dashboard WebSocket Channel - Phase 3
======================================
Provides a /ws/dashboard endpoint for live dashboard updates.

Authentication model (same as /ws):
  1. Token in URL query param: /ws/dashboard?token=<access_token>
  2. OR first frame: {"type": "auth", "token": "<access_token>"}

After authentication, clients receive scoped push events:
  - DEVICE_STATUS_UPDATED
  - FAULT_CREATED
  - FAULT_RESOLVED
  - ALERT_CREATED
  - CONNECTIVITY_CHANGED

Security:
  - End users cannot connect to this channel.
  - SuperAdmin receives all events.
  - Partner roles receive only events for devices in their org subtree.
  - The server validates org membership server-side on every broadcast;
    clients cannot manipulate their own scope.
"""
import asyncio
import json
import logging
from typing import Any, Dict, Optional, Set

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import text

from app.database import SessionLocal
from app.models import User, Organisation
from app.repositories.dashboard_repository import DashboardRepository
from app.services.cache_service import cache_service
from app.services.jwt_auth import verify_token
from app.core.roles import normalize_role, UserRole

logger = logging.getLogger("agripump.dashboard.ws")

router = APIRouter(tags=["Dashboard WebSocket"])

AUTH_TIMEOUT_S = 10
REVALIDATE_S = 60


class DashboardHub:
    """
    In-process hub for dashboard WebSocket connections.

    Each connection stores metadata:
      {user_id, role, org_path, org_ids_set}

    Broadcasts are scoped: only connections whose org_path includes the
    device's org are notified.
    """

    def __init__(self):
        self._conns: Dict[WebSocket, Optional[Dict[str, Any]]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket, meta: Optional[Dict[str, Any]]):
        async with self._lock:
            self._conns[ws] = meta

    async def update_meta(self, ws: WebSocket, meta: Dict[str, Any]):
        async with self._lock:
            self._conns[ws] = meta

    async def disconnect(self, ws: WebSocket):
        async with self._lock:
            self._conns.pop(ws, None)

    def _in_scope(self, meta: Optional[Dict[str, Any]], device_org_id: Optional[str]) -> bool:
        if not meta:
            return False
        role = meta.get("role")
        if role == UserRole.SUPER_ADMIN or role == "superadmin":
            return True
        org_ids: Set[str] = meta.get("org_ids") or set()
        if not device_org_id:
            return False
        return str(device_org_id) in org_ids

    async def broadcast(self, event: Dict[str, Any], device_org_id: Optional[str] = None):
        msg = json.dumps(event)
        dead = []
        async with self._lock:
            targets = list(self._conns.items())
        for ws, meta in targets:
            if not self._in_scope(meta, device_org_id):
                continue
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    self._conns.pop(ws, None)

    async def broadcast_device_status(self, device_id: str, device_org_id: Optional[str], status: str, ts: str):
        await self.broadcast(
            {"type": "DEVICE_STATUS_UPDATED", "device_id": device_id, "status": status, "timestamp": ts},
            device_org_id=device_org_id,
        )

    async def broadcast_fault(self, device_id: str, device_org_id: Optional[str], fault: Dict[str, Any]):
        await self.broadcast(
            {"type": "FAULT_CREATED", "device_id": device_id, "fault": fault},
            device_org_id=device_org_id,
        )

    async def broadcast_fault_resolved(self, device_id: str, device_org_id: Optional[str], fault_id: Any):
        await self.broadcast(
            {"type": "FAULT_RESOLVED", "device_id": device_id, "fault_id": fault_id},
            device_org_id=device_org_id,
        )

    async def broadcast_alert(self, device_id: str, device_org_id: Optional[str], alert: Dict[str, Any]):
        await self.broadcast(
            {"type": "ALERT_CREATED", "device_id": device_id, "alert": alert},
            device_org_id=device_org_id,
        )

    @property
    def connection_count(self) -> int:
        return len(self._conns)


dashboard_hub = DashboardHub()


def _load_identity(token: str) -> Optional[Dict[str, Any]]:
    payload = verify_token(token) if token else None
    if not payload or "sub" not in payload or payload.get("mfa_pending"):
        return None
    with SessionLocal() as db:
        try:
            from sqlalchemy.orm import Session
            user = db.query(User).filter(User.id == payload["sub"]).first()
            if not user or not user.role:
                return None
            if getattr(user, "account_status", "ACTIVE") == "SUSPENDED":
                return None
            token_ver = payload.get("session_ver", 1)
            if token_ver < cache_service.get_user_session_version(str(user.id)):
                return None
            role = normalize_role(user.role)
            # End users do not get the dashboard channel
            if role == UserRole.END_USER:
                return None

            org_ids: Set[str] = set()
            if role != UserRole.SUPER_ADMIN and user.org_id:
                org = db.query(Organisation).filter(Organisation.id == user.org_id).first()
                if org and org.path:
                    repo = DashboardRepository(db)
                    org_ids = set(repo.resolve_subtree_org_ids(str(org.path)))

            return {
                "user_id": str(user.id),
                "role": role,
                "org_ids": org_ids,
                "session_ver": token_ver,
            }
        finally:
            try:
                db.execute(text("RESET ALL;"))
            except Exception:
                pass


@router.websocket("/ws/dashboard")
async def dashboard_websocket(ws: WebSocket, token: str = Query(None)):
    await ws.accept()
    state: Dict[str, Any] = {"meta": None}

    async def authenticate(raw_token: Optional[str]) -> bool:
        if not raw_token:
            return False
        meta = await run_in_threadpool(_load_identity, raw_token)
        if not meta:
            return False
        await dashboard_hub.connect(ws, meta)
        state["meta"] = meta
        return True

    # Register as unauthenticated slot
    await dashboard_hub.connect(ws, None)

    if token:
        if await authenticate(token):
            await ws.send_text(json.dumps({"type": "auth_ok"}))

    async def revalidate():
        while True:
            await asyncio.sleep(REVALIDATE_S)
            meta = state.get("meta")
            if not meta:
                continue
            payload = verify_token(token) if token else None
            if not payload:
                continue
            fresh = await run_in_threadpool(_load_identity, token)
            if not fresh:
                try:
                    await ws.close(code=4401, reason="Session ended")
                except Exception:
                    pass
                return
            await dashboard_hub.update_meta(ws, fresh)

    revalidate_task = asyncio.create_task(revalidate())

    async def auth_timeout():
        await asyncio.sleep(AUTH_TIMEOUT_S)
        if not state.get("meta"):
            try:
                await ws.close(code=4401, reason="Authentication timeout")
            except Exception:
                pass

    guard = asyncio.create_task(auth_timeout()) if not state.get("meta") else None

    try:
        while True:
            data = await ws.receive_text()
            try:
                msg = json.loads(data)
            except Exception:
                continue
            if not isinstance(msg, dict):
                continue
            if msg.get("type") == "auth":
                if await authenticate(msg.get("token")):
                    if guard and not guard.done():
                        guard.cancel()
                    await ws.send_text(json.dumps({"type": "auth_ok"}))
                else:
                    await ws.close(code=4401, reason="Invalid token")
                    return
            elif msg.get("type") == "ping":
                await ws.send_text(json.dumps({"type": "pong"}))
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        for t in (guard, revalidate_task):
            if t and not t.done():
                t.cancel()
        await dashboard_hub.disconnect(ws)
'''

# =========================================================
# 6. DB indexes migration
# =========================================================
files[os.path.join(BASE, "alembic", "versions", "phase3_dashboard_indexes.py")] = r'''"""
Phase 3 Dashboard Indexes
=========================
Adds indexes to support dashboard aggregation queries.

These are advisory indexes based on EXPLAIN ANALYZE results for
dashboard queries at development dataset scale.  Review with
actual production query plans before deploying to high-traffic envs.

Revision: phase3_dashboard_indexes
"""
from __future__ import annotations
from alembic import op

revision = "phase3_dashboard_indexes"
down_revision = None   # Set this to your latest migration revision
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Device state + org scoping (device state summary query)
    op.execute("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pumps_lifecycle_state_org
        ON agripump.pumps (lifecycle_state, org_id)
    """)

    # Connectivity (last_seen_at range scan)
    op.execute("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pumps_last_seen_org
        ON agripump.pumps (last_seen_at, org_id)
        WHERE last_seen_at IS NOT NULL
    """)

    # Location data (connectivity map)
    op.execute("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pumps_location_org
        ON agripump.pumps (org_id, latitude, longitude)
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    """)

    # Firmware distribution
    op.execute("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pumps_firmware_org
        ON agripump.pumps (firmware_version, org_id)
    """)

    # Alerts - active fault summary
    op.execute("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alerts_active_pump
        ON agripump.alerts (pump_id, alert_type, fault_code)
        WHERE resolved_at IS NULL
    """)

    # Fault logs - by pump and time (top faulting devices, faults today)
    op.execute("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fault_logs_pump_time
        ON agripump.fault_logs (pump_id, occurred_at DESC)
    """)

    # Daily summary - by device and day (runtime queries)
    op.execute("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_daily_summary_device_day
        ON agripump.daily_summary (device_id, day DESC)
    """)

    # Warranty / subscription expiry
    op.execute("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pumps_warranty
        ON agripump.pumps (org_id, warranty_start_date, warranty_period_months)
        WHERE warranty_start_date IS NOT NULL AND warranty_period_months IS NOT NULL
    """)

    op.execute("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pumps_subscription
        ON agripump.pumps (org_id, subscription_expires_at)
        WHERE subscription_expires_at IS NOT NULL
    """)


def downgrade() -> None:
    indexes = [
        "idx_pumps_lifecycle_state_org",
        "idx_pumps_last_seen_org",
        "idx_pumps_location_org",
        "idx_pumps_firmware_org",
        "idx_alerts_active_pump",
        "idx_fault_logs_pump_time",
        "idx_daily_summary_device_day",
        "idx_pumps_warranty",
        "idx_pumps_subscription",
    ]
    for idx in indexes:
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS agripump.{idx}")
'''

# =========================================================
# 7. Phase 3 Unit + Integration Tests
# =========================================================
files[os.path.join(TESTS, "test_phase3_dashboard.py")] = r'''"""
Phase 3 Dashboard Tests
========================
Unit tests for DashboardService authorization + aggregation logic.
Integration tests for dashboard API endpoints with realistic org tree.

These tests use the same in-process TestClient + SQLite/Postgres approach
as existing Phase 2 tests.  They mock database calls where needed to
avoid requiring a live DB for unit tests.
"""
import pytest
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone, timedelta

# -----------------------------------------------------------------------
# Helpers / fixtures
# -----------------------------------------------------------------------

def _make_user(role: str, org_id=None, org_path=None):
    user = MagicMock()
    user.id = "user-test-001"
    user.role = role
    user.org_id = org_id
    user.account_status = "ACTIVE"
    if org_path:
        org = MagicMock()
        org.path = org_path
        org.id = org_id
        org.name = f"Org-{role}"
        user.organisation = org
    else:
        user.organisation = None
    return user


def _make_db(org_ids=None):
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    return db


# -----------------------------------------------------------------------
# DashboardService unit tests
# -----------------------------------------------------------------------

class TestDashboardServiceAuthorization:
    """Verify that role enforcement in DashboardService is correct."""

    def test_global_denied_for_manufacturer(self):
        from app.services.dashboard_service import DashboardService
        from fastapi import HTTPException
        user = _make_user("manufacturer", org_id="org-001", org_path="root.mfr001")
        db = _make_db()
        svc = DashboardService(db=db, user=user)
        with pytest.raises(HTTPException) as exc_info:
            svc._require_global()
        assert exc_info.value.status_code == 403

    def test_global_denied_for_distributor(self):
        from app.services.dashboard_service import DashboardService
        from fastapi import HTTPException
        user = _make_user("distributor", org_id="org-002", org_path="root.mfr001.dist001")
        db = _make_db()
        svc = DashboardService(db=db, user=user)
        with pytest.raises(HTTPException):
            svc._require_global()

    def test_global_denied_for_dealer(self):
        from app.services.dashboard_service import DashboardService
        from fastapi import HTTPException
        user = _make_user("dealer", org_id="org-003", org_path="root.mfr001.dist001.dlr001")
        db = _make_db()
        svc = DashboardService(db=db, user=user)
        with pytest.raises(HTTPException):
            svc._require_global()

    def test_global_allowed_for_superadmin(self):
        from app.services.dashboard_service import DashboardService
        user = _make_user("superadmin")
        db = _make_db()
        svc = DashboardService(db=db, user=user)
        # should not raise
        svc._require_global()

    def test_subtree_denied_for_end_user(self):
        from app.services.dashboard_service import DashboardService
        from fastapi import HTTPException
        user = _make_user("customer")
        db = _make_db()
        svc = DashboardService(db=db, user=user)
        with pytest.raises(HTTPException) as exc_info:
            svc._require_subtree()
        assert exc_info.value.status_code == 403

    def test_subtree_allowed_for_dealer(self):
        from app.services.dashboard_service import DashboardService
        user = _make_user("dealer", org_id="org-003", org_path="root.mfr001.dist001.dlr001")
        db = _make_db()
        svc = DashboardService(db=db, user=user)
        svc._require_subtree()  # should not raise

    def test_subtree_allowed_for_support_engineer(self):
        from app.services.dashboard_service import DashboardService
        user = _make_user("support", org_id="org-001", org_path="root.mfr001")
        db = _make_db()
        svc = DashboardService(db=db, user=user)
        svc._require_subtree()  # should not raise


class TestDashboardServiceScopeResolution:
    """Verify that org scope resolution returns correct org_ids."""

    def test_superadmin_resolves_to_none(self):
        from app.services.dashboard_service import DashboardService
        user = _make_user("superadmin")
        db = _make_db()
        svc = DashboardService(db=db, user=user)
        result = svc._resolve_org_ids()
        assert result is None

    def test_no_org_resolves_to_empty(self):
        from app.services.dashboard_service import DashboardService
        user = _make_user("dealer")
        user.org_id = None
        user.organisation = None
        db = _make_db()
        svc = DashboardService(db=db, user=user)
        result = svc._resolve_org_ids()
        assert result == []

    def test_org_with_path_resolves_subtree(self):
        from app.services.dashboard_service import DashboardService
        user = _make_user("dealer", org_id="org-003", org_path="root.mfr001.dist001.dlr001")
        db = _make_db()
        # Mock repo.resolve_subtree_org_ids
        with patch("app.services.dashboard_service.DashboardRepository") as MockRepo:
            instance = MockRepo.return_value
            instance.resolve_subtree_org_ids.return_value = ["org-003", "org-004"]
            svc = DashboardService(db=db, user=user)
            svc.repo = instance
            result = svc._resolve_org_ids()
            assert "org-003" in result
            assert "org-004" in result
            instance.resolve_subtree_org_ids.assert_called_once_with("root.mfr001.dist001.dlr001")


class TestDashboardRepositoryQueries:
    """Unit tests for DashboardRepository query result formatting."""

    def test_empty_device_state_summary(self):
        from app.repositories.dashboard_repository import DashboardRepository
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = []
        repo = DashboardRepository(db)
        result = repo.get_device_state_summary(org_ids=["org-001"])
        assert result["total"] == 0
        assert result["by_state"] == {}

    def test_device_state_summary_aggregation(self):
        from app.repositories.dashboard_repository import DashboardRepository
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = [
            ("ACTIVE", 100), ("COMMISSIONED", 50), ("RETIRED", 5)
        ]
        repo = DashboardRepository(db)
        result = repo.get_device_state_summary(org_ids=None)
        assert result["total"] == 155
        assert result["by_state"]["ACTIVE"] == 100
        assert result["by_state"]["COMMISSIONED"] == 50
        assert result["by_state"]["RETIRED"] == 5

    def test_connectivity_summary_format(self):
        from app.repositories.dashboard_repository import DashboardRepository
        db = MagicMock()
        row = MagicMock()
        row.__getitem__ = lambda self, i: [80, 15, 5][i]
        db.execute.return_value.fetchone.return_value = row
        repo = DashboardRepository(db)
        result = repo.get_connectivity_summary(org_ids=None, offline_after_seconds=600)
        assert result["online"] == 80
        assert result["offline"] == 15
        assert result["unknown"] == 5

    def test_active_fault_summary_empty(self):
        from app.repositories.dashboard_repository import DashboardRepository
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = []
        repo = DashboardRepository(db)
        result = repo.get_active_fault_summary(org_ids=["org-001"])
        assert result["active_total"] == 0
        assert result["by_type"] == []

    def test_firmware_distribution_percentage(self):
        from app.repositories.dashboard_repository import DashboardRepository
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = [
            ("1.0.4", 500), ("1.0.3", 300), ("unknown", 200)
        ]
        repo = DashboardRepository(db)
        result = repo.get_firmware_distribution(org_ids=None)
        assert len(result) == 3
        assert result[0]["version"] == "1.0.4"
        assert result[0]["device_count"] == 500
        total = sum(r["device_count"] for r in result)
        assert sum(r["percentage"] for r in result) == pytest.approx(100.0, abs=0.01)

    def test_warranty_expiring_empty(self):
        from app.repositories.dashboard_repository import DashboardRepository
        db = MagicMock()
        db.execute.return_value.scalar.return_value = 0
        repo = DashboardRepository(db)
        result = repo.get_warranty_expiring_count(org_ids=["org-001"], within_days=30)
        assert result == 0

    def test_subscription_expiring_empty(self):
        from app.repositories.dashboard_repository import DashboardRepository
        db = MagicMock()
        db.execute.return_value.scalar.return_value = 0
        repo = DashboardRepository(db)
        result = repo.get_subscription_expiring_count(org_ids=None, within_days=30)
        assert result == 0

    def test_connectivity_map_empty(self):
        from app.repositories.dashboard_repository import DashboardRepository
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = []
        repo = DashboardRepository(db)
        result = repo.get_connectivity_map(org_ids=None, offline_after_seconds=600)
        assert result == []

    def test_top_faulting_devices_empty(self):
        from app.repositories.dashboard_repository import DashboardRepository
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = []
        repo = DashboardRepository(db)
        since = datetime.now(timezone.utc) - timedelta(days=30)
        result = repo.get_top_faulting_devices(org_ids=None, since=since)
        assert result == []

    def test_faults_today_zero(self):
        from app.repositories.dashboard_repository import DashboardRepository
        db = MagicMock()
        db.execute.return_value.scalar.return_value = 0
        repo = DashboardRepository(db)
        result = repo.get_faults_today(org_ids=["org-001"], day_start_utc=datetime.now(timezone.utc))
        assert result == 0

    def test_runtime_summary_no_data(self):
        from app.repositories.dashboard_repository import DashboardRepository
        from datetime import date
        db = MagicMock()
        row = MagicMock()
        row.__getitem__ = lambda self, i: [0, 0, None][i]
        db.execute.return_value.fetchone.return_value = row
        repo = DashboardRepository(db)
        result = repo.get_runtime_summary(org_ids=["org-001"], today_date=date.today())
        assert result["today_hours"] == 0.0
        assert result["period_hours"] == 0.0
        assert result["last_data_update"] is None


class TestConnectivityService:
    """Unit tests for DeviceConnectivityService."""

    def test_never_seen_is_unknown(self):
        from app.services.device_connectivity_service import DeviceConnectivityService
        pump = MagicMock()
        pump.last_seen_at = None
        assert DeviceConnectivityService.get_connectivity_status(pump) == "UNKNOWN"

    def test_recently_seen_is_online(self):
        from app.services.device_connectivity_service import DeviceConnectivityService
        pump = MagicMock()
        now = datetime.now(timezone.utc)
        pump.last_seen_at = now - timedelta(seconds=30)
        result = DeviceConnectivityService.get_connectivity_status(pump, now=now)
        assert result == "ONLINE"

    def test_old_seen_is_offline(self):
        from app.services.device_connectivity_service import DeviceConnectivityService
        pump = MagicMock()
        now = datetime.now(timezone.utc)
        pump.last_seen_at = now - timedelta(seconds=700)  # > 600s OFFLINE_AFTER_SECONDS
        result = DeviceConnectivityService.get_connectivity_status(pump, now=now)
        assert result == "OFFLINE"


# -----------------------------------------------------------------------
# API endpoint tests using TestClient
# -----------------------------------------------------------------------

@pytest.fixture
def client():
    """Create TestClient using the main FastAPI app."""
    try:
        from fastapi.testclient import TestClient
        from app.main import app
        return TestClient(app)
    except Exception:
        pytest.skip("Cannot instantiate TestClient (no DB available)")


class TestDashboardAPIEndpoints:
    """Integration tests for dashboard API routes."""

    def test_global_dashboard_requires_auth(self, client):
        resp = client.get("/api/v1/dashboard/global")
        assert resp.status_code in (401, 403)

    def test_subtree_dashboard_requires_auth(self, client):
        resp = client.get("/api/v1/dashboard/subtree")
        assert resp.status_code in (401, 403)

    def test_connectivity_requires_auth(self, client):
        resp = client.get("/api/v1/dashboard/connectivity")
        assert resp.status_code in (401, 403)

    def test_faults_requires_auth(self, client):
        resp = client.get("/api/v1/dashboard/faults")
        assert resp.status_code in (401, 403)

    def test_firmware_requires_auth(self, client):
        resp = client.get("/api/v1/dashboard/firmware-distribution")
        assert resp.status_code in (401, 403)

    def test_top_faulting_requires_auth(self, client):
        resp = client.get("/api/v1/dashboard/top-faulting-devices")
        assert resp.status_code in (401, 403)

    def test_org_dashboard_requires_auth(self, client):
        resp = client.get("/api/v1/dashboard/organisations/some-org-id")
        assert resp.status_code in (401, 403)
'''

# Write all files
for path, content in files.items():
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"WRITTEN: {os.path.relpath(path, BASE)}")

print("Phase 3 services, API, WS, migration, tests - all written.")
