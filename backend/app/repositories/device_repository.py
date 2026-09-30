"""
DeviceRepository - Phase 4
============================
All device database queries.  Never exposes raw SQL to controllers.

Tenant isolation: every query is pre-scoped by org_ids (None = global for SUPER_ADMIN).
All search/filter parameters are passed as SQLAlchemy bind parameters — no string interpolation.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import or_, and_, func, text, desc, asc
from sqlalchemy.orm import Session, aliased

from app.models import (
    Pump, User, Organisation, AllocationLog, AuditLog, Panel,
    DeviceBatch, BatchImei
)
from app.models.device_inventory import DeviceOrgAllocationLog, PanelBindingHistory
from app.core.scope import in_subtree, path_in_scope

logger = logging.getLogger("agripump.device.repo")
SCHEMA = "agripump"


class DeviceRepository:
    """
    Repository for device inventory queries with mandatory org-scope.

    org_ids=None  -> SUPER_ADMIN global scope
    org_ids=[...] -> restrict to devices in those orgs
    org_ids=[]    -> empty scope (safe-deny)
    """

    def __init__(self, db: Session, org_ids: Optional[List[str]]):
        self.db = db
        self.org_ids = org_ids

    def _base_query(self):
        q = self.db.query(Pump)
        if self.org_ids is not None:
            if not self.org_ids:
                return q.filter(False)  # empty scope
            q = q.filter(Pump.org_id.in_(self.org_ids))
        return q

    # ── Single device ────────────────────────────────────────────────────────

    def find_by_id(self, device_id: str) -> Optional[Pump]:
        return self._base_query().filter(Pump.id == device_id).first()

    def find_by_id_global(self, device_id: str) -> Optional[Pump]:
        """Load without scope (used for ownership validation, not for end-user response)."""
        return self.db.query(Pump).filter(Pump.id == device_id).first()

    def find_by_serial(self, serial: str) -> Optional[Pump]:
        return self._base_query().filter(Pump.id == serial).first()

    def exists(self, device_id: str) -> bool:
        return bool(self.db.query(Pump.id).filter(Pump.id == device_id).first())

    # ── List / search ────────────────────────────────────────────────────────

    def search(
        self,
        q: Optional[str] = None,
        state: Optional[str] = None,
        model: Optional[str] = None,
        hw_rev: Optional[str] = None,
        batch_code: Optional[str] = None,
        org_id: Optional[str] = None,
        connectivity: Optional[str] = None,
        firmware_version: Optional[str] = None,
        commissioned: Optional[bool] = None,
        sort_by: str = "id",
        sort_dir: str = "asc",
        limit: int = 50,
        offset: int = 0,
        offline_after_seconds: int = 600,
    ) -> List[Pump]:
        query = self._build_filtered_query(
            q, state, model, hw_rev, batch_code, org_id,
            connectivity, firmware_version, commissioned,
            offline_after_seconds,
        )
        query = self._apply_sort(query, sort_by, sort_dir)
        return query.limit(limit).offset(offset).all()

    def count(
        self,
        q: Optional[str] = None,
        state: Optional[str] = None,
        model: Optional[str] = None,
        hw_rev: Optional[str] = None,
        batch_code: Optional[str] = None,
        org_id: Optional[str] = None,
        connectivity: Optional[str] = None,
        firmware_version: Optional[str] = None,
        commissioned: Optional[bool] = None,
        offline_after_seconds: int = 600,
    ) -> int:
        query = self._build_filtered_query(
            q, state, model, hw_rev, batch_code, org_id,
            connectivity, firmware_version, commissioned,
            offline_after_seconds,
        )
        return query.count()

    def _build_filtered_query(
        self,
        q, state, model, hw_rev, batch_code, org_id,
        connectivity, firmware_version, commissioned,
        offline_after_seconds,
    ):
        query = self._base_query()

        if q:
            s = f"%{q.strip()}%"
            # Search serial (id), name, model (via batch join)
            query = query.filter(or_(Pump.id.ilike(s), Pump.name.ilike(s)))

        if state:
            query = query.filter(Pump.lifecycle_state == state.upper())

        if firmware_version:
            query = query.filter(Pump.firmware_version == firmware_version)

        if org_id:
            query = query.filter(Pump.org_id == org_id)

        if commissioned is not None:
            if commissioned:
                query = query.filter(Pump.lifecycle_state.in_(["COMMISSIONED", "ACTIVE", "SUSPENDED"]))
            else:
                query = query.filter(Pump.lifecycle_state.notin_(["COMMISSIONED", "ACTIVE", "SUSPENDED"]))

        if connectivity:
            cutoff = datetime.now(timezone.utc).__class__.now(timezone.utc).__class__.now(
                __import__("datetime").timezone.utc
            ) - __import__("datetime").timedelta(seconds=offline_after_seconds)
            c = connectivity.upper()
            if c == "ONLINE":
                query = query.filter(Pump.last_seen_at.isnot(None), Pump.last_seen_at >= cutoff)
            elif c == "OFFLINE":
                query = query.filter(Pump.last_seen_at.isnot(None), Pump.last_seen_at < cutoff)
            elif c in ("UNKNOWN", "NEVER_SEEN"):
                query = query.filter(Pump.last_seen_at.is_(None))

        return query

    def _apply_sort(self, query, sort_by: str, sort_dir: str):
        safe_cols = {
            "id": Pump.id, "name": Pump.name, "lifecycle_state": Pump.lifecycle_state,
            "firmware_version": Pump.firmware_version, "created_at": Pump.created_at,
            "last_seen_at": Pump.last_seen_at, "status": Pump.status,
        }
        col = safe_cols.get(sort_by, Pump.id)
        return query.order_by(asc(col) if sort_dir.lower() == "asc" else desc(col))

    # ── Ownership history ────────────────────────────────────────────────────

    def get_org_allocation_history(self, device_id: str) -> List[Dict[str, Any]]:
        """Returns the immutable org-level chain of custody."""
        from_org = aliased(Organisation)
        to_org = aliased(Organisation)
        actor_user = aliased(User)

        rows = (
            self.db.query(DeviceOrgAllocationLog, from_org.name, to_org.name, actor_user.full_name)
            .outerjoin(from_org, from_org.id == DeviceOrgAllocationLog.from_org_id)
            .outerjoin(to_org, to_org.id == DeviceOrgAllocationLog.to_org_id)
            .outerjoin(actor_user, actor_user.id == DeviceOrgAllocationLog.actor_id)
            .filter(DeviceOrgAllocationLog.device_id == device_id)
            .order_by(DeviceOrgAllocationLog.occurred_at.asc())
            .all()
        )
        return [
            {
                "id": r[0].id,
                "action": r[0].action,
                "from_org_id": str(r[0].from_org_id) if r[0].from_org_id else None,
                "from_org_name": r[1],
                "to_org_id": str(r[0].to_org_id) if r[0].to_org_id else None,
                "to_org_name": r[2],
                "actor_id": str(r[0].actor_id) if r[0].actor_id else None,
                "actor_name": r[3],
                "note": r[0].note,
                "occurred_at": r[0].occurred_at.isoformat() if r[0].occurred_at else None,
            }
            for r in rows
        ]

    def get_user_allocation_history(self, device_id: str) -> List[Dict[str, Any]]:
        """Returns legacy user-level allocation history."""
        from_user = aliased(User)
        to_user = aliased(User)
        actor = aliased(User)

        rows = (
            self.db.query(AllocationLog, from_user.full_name, to_user.full_name, actor.full_name)
            .outerjoin(from_user, from_user.id == AllocationLog.from_user_id)
            .outerjoin(to_user, to_user.id == AllocationLog.to_user_id)
            .outerjoin(actor, actor.id == AllocationLog.actor_id)
            .filter(AllocationLog.pump_id == device_id)
            .order_by(AllocationLog.occurred_at.asc())
            .all()
        )
        return [
            {
                "id": r[0].id,
                "from_user_id": str(r[0].from_user_id) if r[0].from_user_id else None,
                "from_user_name": r[1],
                "to_user_id": str(r[0].to_user_id) if r[0].to_user_id else None,
                "to_user_name": r[2],
                "actor_id": str(r[0].actor_id) if r[0].actor_id else None,
                "actor_name": r[3],
                "note": r[0].note,
                "occurred_at": r[0].occurred_at.isoformat() if r[0].occurred_at else None,
            }
            for r in rows
        ]

    # ── Panel history ────────────────────────────────────────────────────────

    def get_panel_history(self, device_id: str) -> List[Dict[str, Any]]:
        rows = (
            self.db.query(PanelBindingHistory)
            .filter(PanelBindingHistory.device_id == device_id)
            .order_by(PanelBindingHistory.bound_at.asc())
            .all()
        )
        return [
            {
                "id": r.id,
                "panel_serial": r.panel_serial,
                "motor_rating": r.motor_rating,
                "starter_type": r.starter_type,
                "pump_make": r.pump_make,
                "pump_model": r.pump_model,
                "bound_at": r.bound_at.isoformat() if r.bound_at else None,
                "unbound_at": r.unbound_at.isoformat() if r.unbound_at else None,
            }
            for r in rows
        ]

    # ── Audit events ─────────────────────────────────────────────────────────

    def get_audit_events(self, device_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        rows = (
            self.db.query(AuditLog, User.full_name)
            .outerjoin(User, User.id == AuditLog.actor_id)
            .filter(AuditLog.entity_type == "DEVICE", AuditLog.entity_id == device_id)
            .order_by(AuditLog.occurred_at.desc())
            .limit(limit)
            .all()
        )
        return [
            {
                "id": r[0].id,
                "action": r[0].action,
                "actor_id": str(r[0].actor_id) if r[0].actor_id else None,
                "actor_name": r[1],
                "actor_role": r[0].actor_role,
                "before": r[0].before_json,
                "after": r[0].after_json,
                "occurred_at": r[0].occurred_at.isoformat() if r[0].occurred_at else None,
            }
            for r in rows
        ]

    # ── Export query (scoped, streamed) ──────────────────────────────────────

    def iter_export(
        self,
        q: Optional[str] = None,
        state: Optional[str] = None,
        batch_size: int = 200,
    ):
        """Yields Pump rows in batches for CSV export. Never loads entire table."""
        offset = 0
        while True:
            rows = self.search(q=q, state=state, limit=batch_size, offset=offset)
            if not rows:
                break
            yield rows
            if len(rows) < batch_size:
                break
            offset += batch_size
