"""
DashboardRepository - Phase 3 data access layer.

All aggregation SQL lives here. Every statement is parameterised and every statement that reads devices carries the
mandatory scope predicate built by `_pump_scope`:

    org_ids=None, hier_path=None   -> global (SUPER_ADMIN only; the service is the only caller that may pass this)
    otherwise                      -> the device is in one of `org_ids` (organisation subtree) OR sits at/below
                                      `hier_path` (legacy slash path, boundary-safe)

That is deliberately the same rule as the database's own row-level security policy on `pumps`, so an explicit
predicate and RLS can never disagree about what a partner may see, and an empty scope denies everything.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.device_connectivity_service import DeviceConnectivityService as Conn

logger = logging.getLogger("agripump.dashboard.repo")
SCHEMA = "agripump"

# The lifecycle states the pumps table allows (CHECK constraint). Always returned, zero-filled.
DEVICE_STATES = ("MANUFACTURED", "ALLOCATED", "IN_STOCK", "COMMISSIONED", "ACTIVE", "SUSPENDED", "RMA", "RETIRED")

Filters = Optional[Dict[str, Any]]


def _pump_scope(alias: str, org_ids: Optional[List[str]], hier_path: Optional[str], params: Dict[str, Any]) -> str:
    """SQL condition limiting `alias` (a pumps row) to the caller's scope. '' means global."""
    if org_ids is None and hier_path is None:
        return ""
    a = f"{alias}." if alias else ""
    parts: List[str] = []
    if org_ids:
        params["org_ids"] = [str(o) for o in org_ids]
        parts.append(f"{a}org_id = ANY(CAST(:org_ids AS uuid[]))")
    if hier_path and hier_path.rstrip("/"):
        hp = hier_path.rstrip("/")
        # `/SA/D1` covers itself and `/SA/D1/...`, never `/SA/D10`: everything from "/SA/D1/" up to (not including)
        # "/SA/D10" ('/' sorts immediately before '0'). Written with the pattern-ops range operators rather than LIKE:
        # they compare bytes (collation-independent, no wildcard characters to escape) and, unlike a LIKE prefix, the
        # text_pattern_ops index on hierarchy_path serves them on every collation (30 ms -> 0.2 ms at 100k devices).
        params["hp"] = hp
        params["hp_lo"] = hp + "/"
        params["hp_hi"] = hp + "0"
        parts.append(
            f"({a}hierarchy_path = :hp OR ({a}hierarchy_path ~>=~ :hp_lo AND {a}hierarchy_path ~<~ :hp_hi))"
        )
    return "(" + " OR ".join(parts) + ")" if parts else "FALSE"


def _pump_filters(alias: str, filters: Filters, params: Dict[str, Any]) -> List[str]:
    """Server-side filters. Only ones the data model actually supports; values are always bound, never inlined."""
    if not filters:
        return []
    a = f"{alias}." if alias else ""
    out: List[str] = []
    if filters.get("state"):
        params["f_state"] = str(filters["state"]).upper()
        out.append(f"{a}lifecycle_state = :f_state")
    if filters.get("firmware_version"):
        params["f_fw"] = str(filters["firmware_version"])
        out.append(f"COALESCE({a}firmware_version, 'unknown') = :f_fw")
    return out


def _where(*conds: str) -> str:
    conds = tuple(c for c in conds if c)
    return ("WHERE " + " AND ".join(conds)) if conds else ""


class DashboardRepository:
    def __init__(self, db: Session):
        self.db = db

    @staticmethod
    def _scoped(org_ids, hier_path, filters, params, alias="p"):
        """(needs_pumps, conditions). A global, unfiltered read needs no join to `pumps` at all - joining it just to
        count every row again is the difference between 0.5 s and 4 s on a 100k-device fleet."""
        conds = [c for c in (_pump_scope(alias, org_ids, hier_path, params), *_pump_filters(alias, filters, params)) if c]
        return bool(conds), conds

    # ------------------------------------------------------------------ helpers
    def _pumps_where(self, org_ids, hier_path, filters, params, alias="p", extra: str = "") -> str:
        return _where(_pump_scope(alias, org_ids, hier_path, params), *_pump_filters(alias, filters, params), extra)

    # ------------------------------------------------------------- device states
    def get_device_state_summary(
        self, org_ids: Optional[List[str]], hier_path: Optional[str] = None, filters: Filters = None
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {}
        where = self._pumps_where(org_ids, hier_path, filters, params)
        rows = self.db.execute(
            text(f"SELECT p.lifecycle_state, COUNT(*) FROM {SCHEMA}.pumps p {where} GROUP BY p.lifecycle_state"), params
        ).fetchall()
        by_state: Dict[str, int] = {s: 0 for s in DEVICE_STATES}
        total = 0
        for state, cnt in rows:
            by_state[(state or "UNKNOWN").upper()] = by_state.get((state or "UNKNOWN").upper(), 0) + int(cnt)
            total += int(cnt)
        return {"total": total, "by_state": by_state}

    # -------------------------------------------------------------- connectivity
    def get_connectivity_summary(
        self, org_ids: Optional[List[str]], offline_after_seconds: int,
        hier_path: Optional[str] = None, filters: Filters = None,
    ) -> Dict[str, int]:
        """online / offline / unknown for devices that are in service; everything else is `not_in_service`.

        The rule is `DeviceConnectivityService`'s, the same one the pump badges and the OFFLINE alert sweep use.
        """
        params: Dict[str, Any] = {"cutoff": Conn.cutoff(offline_after_seconds)}
        where = self._pumps_where(org_ids, hier_path, filters, params)
        pr = Conn.sql_predicates("p")
        row = self.db.execute(
            text(
                f"SELECT COUNT(*) FILTER (WHERE {pr['online']}), COUNT(*) FILTER (WHERE {pr['offline']}), "
                f"COUNT(*) FILTER (WHERE {pr['unknown']}), COUNT(*) FILTER (WHERE {pr['not_in_service']}) "
                f"FROM {SCHEMA}.pumps p {where}"
            ),
            params,
        ).fetchone()
        return {
            "online": int(row[0] or 0), "offline": int(row[1] or 0), "unknown": int(row[2] or 0),
            "not_in_service": int(row[3] or 0) if len(row) > 3 else 0,
        }

    def get_offline_device_list(
        self, org_ids: Optional[List[str]], offline_after_seconds: int, limit: int = 50, offset: int = 0,
        hier_path: Optional[str] = None, filters: Filters = None,
    ) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {"cutoff": Conn.cutoff(offline_after_seconds), "limit": limit, "offset": offset}
        where = self._pumps_where(org_ids, hier_path, filters, params, extra=Conn.sql_predicates("p")["offline"])
        rows = self.db.execute(
            text(
                f"SELECT p.id, p.name, p.status, p.lifecycle_state, p.last_seen_at, o.name, p.firmware_version, "
                f"(SELECT COUNT(*) FROM {SCHEMA}.fault_logs fl WHERE fl.pump_id = p.id AND fl.resolved_at IS NULL "
                f"AND fl.fault_code > 0) "
                f"FROM {SCHEMA}.pumps p LEFT JOIN {SCHEMA}.organisations o ON o.id = p.org_id "
                f"{where} ORDER BY p.last_seen_at ASC, p.id ASC LIMIT :limit OFFSET :offset"
            ),
            params,
        ).fetchall()
        return [
            {"device_id": r[0], "serial": r[0], "name": r[1], "status": "OFFLINE", "lifecycle_state": r[3],
             "last_seen": r[4].isoformat() if r[4] else None, "org_name": r[5], "firmware_version": r[6],
             "open_fault_count": int(r[7] or 0)}
            for r in rows
        ]

    def get_offline_device_count(
        self, org_ids: Optional[List[str]], offline_after_seconds: int,
        hier_path: Optional[str] = None, filters: Filters = None,
    ) -> int:
        params: Dict[str, Any] = {"cutoff": Conn.cutoff(offline_after_seconds)}
        where = self._pumps_where(org_ids, hier_path, filters, params, extra=Conn.sql_predicates("p")["offline"])
        return int(self.db.execute(text(f"SELECT COUNT(*) FROM {SCHEMA}.pumps p {where}"), params).scalar() or 0)

    def get_connectivity_map(
        self, org_ids: Optional[List[str]], offline_after_seconds: int, precision: int = 2,
        hier_path: Optional[str] = None, filters: Filters = None,
    ) -> List[Dict[str, Any]]:
        """Devices grouped into ~1 km cells (2 decimal places). Coordinates are rounded so the map never carries a
        farm's exact position; devices without coordinates are simply absent (never invented)."""
        params: Dict[str, Any] = {"cutoff": Conn.cutoff(offline_after_seconds), "precision": precision}
        where = self._pumps_where(
            org_ids, hier_path, filters, params, extra="p.latitude IS NOT NULL AND p.longitude IS NOT NULL"
        )
        pr = Conn.sql_predicates("p")
        rows = self.db.execute(
            text(
                f"SELECT ROUND(p.latitude::numeric, :precision) AS lat, ROUND(p.longitude::numeric, :precision) AS lng, "
                f"COUNT(*) FILTER (WHERE {pr['online']}), COUNT(*) FILTER (WHERE {pr['offline']}), "
                f"COUNT(*) FILTER (WHERE {pr['unknown']}), COUNT(*) FILTER (WHERE {pr['not_in_service']}), COUNT(*) "
                f"FROM {SCHEMA}.pumps p {where} GROUP BY lat, lng ORDER BY COUNT(*) DESC, lat, lng"
            ),
            params,
        ).fetchall()
        result = []
        for lat, lng, online, offline, unknown, idle, total in rows:
            on, off, unk = int(online or 0), int(offline or 0), int(unknown or 0)
            if on + off + unk == 0:
                status = "NOT_IN_SERVICE"
            else:
                status = "ONLINE" if on >= off and on >= unk else ("OFFLINE" if off >= unk else "UNKNOWN")
            result.append({
                "latitude": float(lat), "longitude": float(lng), "status": status,
                "online_count": on, "offline_count": off, "unknown_count": unk,
                "not_in_service_count": int(idle or 0), "device_count": int(total),
            })
        return result

    # -------------------------------------------------------------------- faults
    def get_active_fault_summary(
        self, org_ids: Optional[List[str]], hier_path: Optional[str] = None, filters: Filters = None
    ) -> Dict[str, Any]:
        """Open hardware-fault alerts grouped by fault code. Connectivity outages (alert_type OFFLINE) are not
        faults: they are reported under `connectivity`."""
        params: Dict[str, Any] = {}
        where = self._pumps_where(
            org_ids, hier_path, filters, params, alias="p", extra="a.resolved_at IS NULL AND a.alert_type = 'FAULT'"
        )
        rows = self.db.execute(
            text(
                f"SELECT a.fault_code, fcc.name, fcc.severity, COUNT(a.id) AS cnt "
                f"FROM {SCHEMA}.alerts a JOIN {SCHEMA}.pumps p ON p.id = a.pump_id "
                f"LEFT JOIN {SCHEMA}.fault_code_catalog fcc ON fcc.code = a.fault_code "
                f"{where} GROUP BY a.fault_code, fcc.name, fcc.severity ORDER BY cnt DESC, a.fault_code"
            ),
            params,
        ).fetchall()
        by_type: List[Dict[str, Any]] = []
        total = 0
        for fault_code, name, severity, cnt in rows:
            n = int(cnt)
            total += n
            by_type.append({
                "code": name or (f"FAULT_{fault_code}" if fault_code is not None else "UNKNOWN"),
                "fault_code": int(fault_code) if fault_code is not None else None,
                "fault_name": name,
                "severity": severity,
                "count": n,
            })
        return {"active_total": total, "by_type": by_type}

    def get_faults_today(
        self, org_ids: Optional[List[str]], day_start_utc: datetime,
        hier_path: Optional[str] = None, filters: Filters = None,
    ) -> int:
        params: Dict[str, Any] = {"day_start": day_start_utc}
        needs_pumps, conds = self._scoped(org_ids, hier_path, filters, params)
        join = f"JOIN {SCHEMA}.pumps p ON p.id = fl.pump_id" if needs_pumps else ""
        where = _where("fl.occurred_at >= :day_start", "fl.fault_code > 0", *conds)
        return int(self.db.execute(
            text(f"SELECT COUNT(*) FROM {SCHEMA}.fault_logs fl {join} {where}"), params).scalar() or 0)

    def get_top_faulting_page(
        self, org_ids: Optional[List[str]], since: datetime, limit: int = 10, offset: int = 0,
        hier_path: Optional[str] = None, filters: Filters = None,
    ) -> tuple:
        """(items, total_devices_with_faults). One pass over the faults: group per device, rank, and only then join
        names for the few rows returned."""
        params: Dict[str, Any] = {"since": since, "limit": limit, "offset": offset}
        needs_pumps, conds = self._scoped(org_ids, hier_path, filters, params)
        join = f"JOIN {SCHEMA}.pumps p ON p.id = fl.pump_id" if needs_pumps else ""
        where = _where("fl.occurred_at >= :since", "fl.fault_code > 0", *conds)
        rows = self.db.execute(
            text(
                f"WITH g AS (SELECT fl.pump_id, COUNT(*) AS fault_count, MAX(fl.occurred_at) AS last_fault_at "
                f"FROM {SCHEMA}.fault_logs fl {join} {where} GROUP BY fl.pump_id), "
                f"page AS (SELECT g.*, COUNT(*) OVER () AS total FROM g "
                f"ORDER BY fault_count DESC, last_fault_at DESC, pump_id LIMIT :limit OFFSET :offset) "
                f"SELECT page.pump_id, p2.name, o.name, page.fault_count, page.last_fault_at, page.total "
                f"FROM page JOIN {SCHEMA}.pumps p2 ON p2.id = page.pump_id "
                f"LEFT JOIN {SCHEMA}.organisations o ON o.id = p2.org_id "
                f"ORDER BY page.fault_count DESC, page.last_fault_at DESC, page.pump_id"
            ),
            params,
        ).fetchall()
        items = [
            {"device_id": r[0], "serial": r[0], "name": r[1], "fault_count": int(r[3]),
             "last_fault": r[4].isoformat() if r[4] else None, "organisation": r[2]}
            for r in rows
        ]
        total = int(rows[0][5]) if rows else 0
        if not rows and offset:  # a page past the end still needs the real total
            total = self.get_top_faulting_devices_count(org_ids, since, hier_path=hier_path, filters=filters)
        return items, total

    def get_top_faulting_devices(
        self, org_ids: Optional[List[str]], since: datetime, limit: int = 10, offset: int = 0,
        hier_path: Optional[str] = None, filters: Filters = None,
    ) -> List[Dict[str, Any]]:
        return self.get_top_faulting_page(org_ids, since, limit, offset, hier_path, filters)[0]

    def get_top_faulting_devices_count(
        self, org_ids: Optional[List[str]], since: datetime,
        hier_path: Optional[str] = None, filters: Filters = None,
    ) -> int:
        params: Dict[str, Any] = {"since": since}
        needs_pumps, conds = self._scoped(org_ids, hier_path, filters, params)
        join = f"JOIN {SCHEMA}.pumps p ON p.id = fl.pump_id" if needs_pumps else ""
        where = _where("fl.occurred_at >= :since", "fl.fault_code > 0", *conds)
        return int(self.db.execute(
            text(f"SELECT COUNT(DISTINCT fl.pump_id) FROM {SCHEMA}.fault_logs fl {join} {where}"), params).scalar() or 0)

    def get_recent_faults(
        self, org_ids: Optional[List[str]], limit: int = 20, offset: int = 0,
        hier_path: Optional[str] = None, filters: Filters = None,
    ) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {"limit": limit, "offset": offset}
        extra = "fl.fault_code > 0"
        if filters and filters.get("fault_code") is not None:
            params["f_code"] = int(filters["fault_code"])
            extra += " AND fl.fault_code = :f_code"
        where = self._pumps_where(org_ids, hier_path, filters, params, extra=extra)
        rows = self.db.execute(
            text(
                f"SELECT fl.id, fl.pump_id, p.name, o.name, fl.fault_code, fcc.name, fl.description, "
                f"fl.occurred_at, fl.resolved_at, fl.contactor_tripped "
                f"FROM {SCHEMA}.fault_logs fl JOIN {SCHEMA}.pumps p ON p.id = fl.pump_id "
                f"LEFT JOIN {SCHEMA}.organisations o ON o.id = p.org_id "
                f"LEFT JOIN {SCHEMA}.fault_code_catalog fcc ON fcc.code = fl.fault_code "
                f"{where} ORDER BY fl.occurred_at DESC, fl.id DESC LIMIT :limit OFFSET :offset"
            ),
            params,
        ).fetchall()
        return [
            {"id": int(r[0]), "device_id": r[1], "device_name": r[2], "org_name": r[3],
             "fault_code": int(r[4]) if r[4] is not None else None,
             "fault_name": r[5] or r[6] or "Unknown",
             "occurred_at": r[7].isoformat() if r[7] else None,
             "resolved_at": r[8].isoformat() if r[8] else None,
             "is_active": r[8] is None, "contactor_tripped": bool(r[9]) if r[9] is not None else False}
            for r in rows
        ]

    def get_recent_faults_count(
        self, org_ids: Optional[List[str]], hier_path: Optional[str] = None, filters: Filters = None
    ) -> int:
        params: Dict[str, Any] = {}
        extra = "fl.fault_code > 0"
        if filters and filters.get("fault_code") is not None:
            params["f_code"] = int(filters["fault_code"])
            extra += " AND fl.fault_code = :f_code"
        where = self._pumps_where(org_ids, hier_path, filters, params, extra=extra)
        return int(
            self.db.execute(
                text(f"SELECT COUNT(*) FROM {SCHEMA}.fault_logs fl JOIN {SCHEMA}.pumps p ON p.id = fl.pump_id {where}"),
                params,
            ).scalar() or 0
        )

    # ------------------------------------------------------------------ firmware
    def get_firmware_distribution(
        self, org_ids: Optional[List[str]], hier_path: Optional[str] = None, filters: Filters = None
    ) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {}
        where = self._pumps_where(org_ids, hier_path, filters, params)
        rows = self.db.execute(
            text(
                f"SELECT COALESCE(p.firmware_version, 'unknown') AS version, COUNT(*) AS device_count "
                f"FROM {SCHEMA}.pumps p {where} GROUP BY 1 ORDER BY device_count DESC, version ASC"
            ),
            params,
        ).fetchall()
        total = sum(int(r[1]) for r in rows)
        return [
            {"version": r[0], "device_count": int(r[1]),
             "percentage": round(int(r[1]) / total * 100, 2) if total > 0 else 0.0}
            for r in rows
        ]

    # ------------------------------------------------------------------- runtime
    def get_runtime_summary(
        self, org_ids: Optional[List[str]], today_date: date, period_days: int = 7,
        hier_path: Optional[str] = None, today_start_utc: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        """Runtime hours for `today_date` (a dashboard-timezone date) and for the last `period_days` days.

        Normal path: one sum over `dashboard_runtime`, the per-device rollup the background refresher keeps current
        (today's minutes and the completed days of the window). If the caller can see no current row for that window
        (fresh install, the first minutes after midnight, or a scope with no activity at all) the figures are computed
        directly: completed days from `daily_summary` (the nightly rollup) and today counted from today's readings,
        so the number is right rather than silently zero. One 'on' reading ~ one minute: the estimate the pump screen
        and the nightly rollup use.
        """
        period_days = max(period_days, 1)
        params: Dict[str, Any] = {"today": today_date, "period_days": period_days}
        needs_pumps, conds = self._scoped(org_ids, hier_path, None, params)
        row = self.db.execute(
            text(
                f"SELECT COALESCE(SUM(rt.runtime_min), 0), COALESCE(SUM(rt.history_min), 0), MAX(rt.updated_at), "
                f"COUNT(*) FROM {SCHEMA}.dashboard_runtime rt "
                f"{f'JOIN {SCHEMA}.pumps p ON p.id = rt.device_id' if needs_pumps else ''} "
                f"{_where('rt.day = :today', 'rt.history_days = :period_days', *conds)}"
            ),
            params,
        ).fetchone()
        if row and int(row[3] or 0) > 0:
            today_min, history_min = int(row[0] or 0), int(row[1] or 0)
            return {
                "today_hours": round(today_min / 60, 2),
                "period_hours": round((today_min + history_min) / 60, 2),
                "period_days": period_days,
                "last_rollup_at": row[2].isoformat() if row[2] else None,
                "today_source": "rollup",
                "today_as_of": row[2].isoformat() if row[2] else None,
            }
        return self._runtime_direct(org_ids, today_date, period_days, hier_path, today_start_utc)

    def _runtime_direct(self, org_ids, today_date, period_days, hier_path, today_start_utc) -> Dict[str, Any]:
        if today_start_utc is None:
            today_start_utc = datetime.combine(today_date, datetime.min.time(), tzinfo=timezone.utc)
        params: Dict[str, Any] = {"today": today_date, "period_start": today_date - timedelta(days=period_days - 1)}
        needs_pumps, conds = self._scoped(org_ids, hier_path, None, params)
        hist = self.db.execute(
            text(
                f"SELECT COALESCE(SUM(ds.runtime_min), 0), MAX(ds.updated_at) FROM {SCHEMA}.daily_summary ds "
                f"{f'JOIN {SCHEMA}.pumps p ON p.id = ds.device_id' if needs_pumps else ''} "
                f"{_where('ds.day >= :period_start', 'ds.day < :today', *conds)}"
            ),
            params,
        ).fetchone()
        live_params: Dict[str, Any] = {"today_start": today_start_utc}
        live_needs_pumps, live_conds = self._scoped(org_ids, hier_path, None, live_params)
        today_min = int(self.db.execute(
            text(
                f"SELECT COUNT(*) FILTER (WHERE t.pump_on) FROM {SCHEMA}.telemetry_history t "
                f"{f'JOIN {SCHEMA}.pumps p ON p.id = t.pump_id' if live_needs_pumps else ''} "
                f"{_where('t.recorded_at >= :today_start', *live_conds)}"
            ),
            live_params,
        ).scalar() or 0)
        history_min = int(hist[0] or 0)
        return {
            "today_hours": round(today_min / 60, 2),
            "period_hours": round((history_min + today_min) / 60, 2),
            "period_days": period_days,
            "last_rollup_at": hist[1].isoformat() if hist[1] else None,
            "today_source": "live",
            "today_as_of": datetime.now(timezone.utc).isoformat(),
        }

    # -------------------------------------------------------- warranty / subscription
    def get_warranty_expiring_count(
        self, org_ids: Optional[List[str]], within_days: int = 30,
        hier_path: Optional[str] = None, today: Optional[date] = None,
    ) -> int:
        today = today or date.today()
        params: Dict[str, Any] = {"today": today, "horizon": today + timedelta(days=within_days)}
        where = self._pumps_where(
            org_ids, hier_path, None, params, extra=(
                "p.warranty_start_date IS NOT NULL AND p.warranty_period_months IS NOT NULL "
                "AND (p.warranty_start_date + (p.warranty_period_months * INTERVAL '1 month')) "
                "BETWEEN :today AND :horizon"
            ),
        )
        return int(self.db.execute(text(f"SELECT COUNT(*) FROM {SCHEMA}.pumps p {where}"), params).scalar() or 0)

    def get_warranty_expiring_list(
        self, org_ids: Optional[List[str]], within_days: int = 30, limit: int = 50, offset: int = 0,
        hier_path: Optional[str] = None, today: Optional[date] = None,
    ) -> List[Dict[str, Any]]:
        today = today or date.today()
        params: Dict[str, Any] = {
            "today": today, "horizon": today + timedelta(days=within_days), "limit": limit, "offset": offset,
        }
        where = self._pumps_where(
            org_ids, hier_path, None, params, extra=(
                "p.warranty_start_date IS NOT NULL AND p.warranty_period_months IS NOT NULL "
                "AND (p.warranty_start_date + (p.warranty_period_months * INTERVAL '1 month')) "
                "BETWEEN :today AND :horizon"
            ),
        )
        rows = self.db.execute(
            text(
                f"SELECT p.id, p.name, p.org_id, o.name, p.warranty_start_date, p.warranty_period_months, "
                f"(p.warranty_start_date + (p.warranty_period_months * INTERVAL '1 month'))::date AS expiry "
                f"FROM {SCHEMA}.pumps p LEFT JOIN {SCHEMA}.organisations o ON o.id = p.org_id "
                f"{where} ORDER BY expiry ASC, p.id ASC LIMIT :limit OFFSET :offset"
            ),
            params,
        ).fetchall()
        return [
            {"device_id": r[0], "name": r[1], "org_id": str(r[2]) if r[2] else None, "org_name": r[3],
             "warranty_start_date": r[4].isoformat() if r[4] else None,
             "warranty_period_months": r[5],
             "warranty_expiry_date": r[6].isoformat() if r[6] else None,
             "days_remaining": (r[6] - today).days if r[6] else None}
            for r in rows
        ]

    def get_subscription_expiring_count(
        self, org_ids: Optional[List[str]], within_days: int = 30, hier_path: Optional[str] = None
    ) -> int:
        now = datetime.now(timezone.utc)
        params: Dict[str, Any] = {"now": now, "horizon": now + timedelta(days=within_days)}
        where = self._pumps_where(
            org_ids, hier_path, None, params,
            extra="p.subscription_expires_at IS NOT NULL AND p.subscription_expires_at BETWEEN :now AND :horizon",
        )
        return int(self.db.execute(text(f"SELECT COUNT(*) FROM {SCHEMA}.pumps p {where}"), params).scalar() or 0)

    def get_subscription_expiring_list(
        self, org_ids: Optional[List[str]], within_days: int = 30, limit: int = 50, offset: int = 0,
        hier_path: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        now = datetime.now(timezone.utc)
        params: Dict[str, Any] = {"now": now, "horizon": now + timedelta(days=within_days), "limit": limit,
                                  "offset": offset}
        where = self._pumps_where(
            org_ids, hier_path, None, params,
            extra="p.subscription_expires_at IS NOT NULL AND p.subscription_expires_at BETWEEN :now AND :horizon",
        )
        rows = self.db.execute(
            text(
                f"SELECT p.id, p.name, o.name, p.subscription_expires_at "
                f"FROM {SCHEMA}.pumps p LEFT JOIN {SCHEMA}.organisations o ON o.id = p.org_id "
                f"{where} ORDER BY p.subscription_expires_at ASC, p.id ASC LIMIT :limit OFFSET :offset"
            ),
            params,
        ).fetchall()
        return [
            {"device_id": r[0], "name": r[1], "org_name": r[2],
             "subscription_expires_at": r[3].isoformat() if r[3] else None,
             "days_remaining": int((r[3] - now).total_seconds() // 86400) if r[3] else None}
            for r in rows
        ]

    # ------------------------------------------------------------- scope / freshness
    def resolve_subtree_org_ids(self, root_org_path: str) -> List[str]:
        sql = text(
            "SELECT id::text FROM agripump.organisations "
            "WHERE path OPERATOR(agripump.<@) CAST(:upath AS agripump.ltree)"
        )
        return [r[0] for r in self.db.execute(sql, {"upath": root_org_path}).fetchall()]

    def get_last_telemetry_update(
        self, org_ids: Optional[List[str]], hier_path: Optional[str] = None
    ) -> Optional[datetime]:
        """The most recent time any in-scope device reported (`pumps.last_seen_at`, kept current by ingest). Reading
        it from the pumps table avoids scanning the telemetry hypertable just to say how fresh the data is."""
        params: Dict[str, Any] = {}
        where = self._pumps_where(org_ids, hier_path, None, params)
        return self.db.execute(text(f"SELECT MAX(p.last_seen_at) FROM {SCHEMA}.pumps p {where}"), params).scalar()
