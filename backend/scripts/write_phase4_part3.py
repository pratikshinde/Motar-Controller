"""
Phase 4 - Part 3: DeviceRepository + DeviceService + PanelBindingService
"""
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(BASE, "app")

files = {}

# =========================================================
# DeviceRepository
# =========================================================
files[os.path.join(APP, "repositories", "device_repository.py")] = r'''"""
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
'''

# =========================================================
# DeviceService (orchestrator)
# =========================================================
files[os.path.join(APP, "services", "device_service.py")] = r'''"""
DeviceService - Phase 4
========================
Business logic orchestrator for device inventory.

Delegates:
  State machine      -> DeviceLifecycleService
  Allocation/return  -> DeviceAllocationService
  CSV import         -> DeviceImportService
  DB queries         -> DeviceRepository
"""
from __future__ import annotations

import csv
import io
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.roles import UserRole, normalize_role
from app.models import Pump, User, Organisation, AuditLog, DeviceConfig
from app.models.device_inventory import PanelBindingHistory
from app.repositories.device_repository import DeviceRepository
from app.services.device_lifecycle_service import DeviceLifecycleService
from app.services.device_allocation_service import DeviceAllocationService
from app.services.device_import_service import DeviceImportService

logger = logging.getLogger("agripump.device.service")

DEVICE_SECRET_FIELDS = frozenset({"device_key_hash", "private_key", "cert_pem"})


class DeviceService:
    """
    Orchestrates all device management operations.

    Usage:
        svc = DeviceService(db=db, actor=current_user)
        result = svc.get_device("PUMP-001")
    """

    def __init__(self, db: Session, actor: User):
        self.db = db
        self.actor = actor
        self._role = normalize_role(actor.role)
        self._lifecycle = DeviceLifecycleService(db)
        self._repo = DeviceRepository(db, org_ids=self._resolve_org_ids())

    # ── Scope resolution ─────────────────────────────────────────────────────

    def _resolve_org_ids(self) -> Optional[List[str]]:
        if self._role == UserRole.SUPER_ADMIN:
            return None
        if not self.actor.org_id:
            return []
        from app.repositories.dashboard_repository import DashboardRepository
        dash_repo = DashboardRepository(self.db)
        return dash_repo.resolve_subtree_org_ids(self._get_actor_org_path())

    def _get_actor_org_path(self) -> str:
        if not self.actor.org_id:
            return ""
        org = self.db.query(Organisation).filter(Organisation.id == self.actor.org_id).first()
        return str(org.path) if org and org.path else ""

    # ── Device detail ────────────────────────────────────────────────────────

    def get_device(self, device_id: str) -> Dict[str, Any]:
        pump = self._repo.find_by_id(device_id)
        if not pump:
            raise HTTPException(status_code=404, detail="DEVICE_NOT_FOUND")
        return self._format_device(pump, include_sensitive=False)

    def list_devices(
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
    ) -> Dict[str, Any]:
        items = self._repo.search(
            q=q, state=state, model=model, hw_rev=hw_rev,
            batch_code=batch_code, org_id=org_id,
            connectivity=connectivity, firmware_version=firmware_version,
            commissioned=commissioned,
            sort_by=sort_by, sort_dir=sort_dir,
            limit=limit, offset=offset,
            offline_after_seconds=offline_after_seconds,
        )
        total = self._repo.count(
            q=q, state=state, model=model, hw_rev=hw_rev,
            batch_code=batch_code, org_id=org_id,
            connectivity=connectivity, firmware_version=firmware_version,
            commissioned=commissioned,
            offline_after_seconds=offline_after_seconds,
        )
        return {
            "items": [self._format_device(p) for p in items],
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": (offset + limit) < total,
        }

    # ── PATCH device (non-lifecycle fields only) ─────────────────────────────

    def update_device(self, device_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
        """
        Update device metadata. MUST NOT accept lifecycle_state or owner_org_id
        in the payload — those go through the lifecycle/allocation services.
        """
        PROHIBITED = {"lifecycle_state", "state", "org_id", "owner_org_id",
                      "owner_user_id", "device_key_hash", "id"}
        if any(k in PROHIBITED for k in updates):
            raise HTTPException(
                status_code=422,
                detail=f"FIELD_NOT_PATCHABLE: use dedicated endpoints for state/ownership changes. "
                       f"Prohibited fields: {sorted(PROHIBITED & set(updates.keys()))}",
            )

        pump = self._repo.find_by_id(device_id)
        if not pump:
            raise HTTPException(status_code=404, detail="DEVICE_NOT_FOUND")

        if self._role not in {UserRole.SUPER_ADMIN, UserRole.PANEL_MANUFACTURER, UserRole.DISTRIBUTOR, UserRole.DEALER}:
            raise HTTPException(status_code=403, detail="DEVICE_UPDATE_FORBIDDEN")

        PATCHABLE = {"name", "hp_rating", "supply_type", "latitude", "longitude",
                     "warranty_start_date", "warranty_period_months",
                     "panel_serial", "motor_rating", "starter_type", "pump_make", "pump_model",
                     "subscription_expires_at"}
        before = {k: getattr(pump, k) for k in PATCHABLE if k in updates}
        changed = {}
        for k, v in updates.items():
            if k in PATCHABLE:
                setattr(pump, k, v)
                changed[k] = v

        if changed:
            self.db.add(AuditLog(
                actor_id=self.actor.id,
                actor_role=self.actor.role,
                entity_type="DEVICE",
                entity_id=device_id,
                action="DEVICE_UPDATED",
                before_json=before,
                after_json=changed,
            ))
            self.db.commit()
            self.db.refresh(pump)

        return self._format_device(pump)

    # ── Lifecycle transition ─────────────────────────────────────────────────

    def transition(self, device_id: str, next_state: str, note: Optional[str] = None) -> Dict[str, Any]:
        pump = self._repo.find_by_id(device_id)
        if not pump:
            raise HTTPException(status_code=404, detail="DEVICE_NOT_FOUND")
        self._lifecycle.transition(pump, next_state, actor=self.actor, note=note)
        self.db.refresh(pump)
        return {
            "device_id": device_id,
            "lifecycle_state": pump.lifecycle_state,
            "allowed_transitions": sorted(self._lifecycle.get_allowed_transitions(pump.lifecycle_state)),
        }

    # ── Allocation ───────────────────────────────────────────────────────────

    def allocate(
        self,
        device_id: str,
        target_org_id: str,
        note: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        svc = DeviceAllocationService(self.db, self.actor)
        return svc.allocate(device_id, target_org_id, note=note, idempotency_key=idempotency_key)

    def return_device(self, device_id: str, note: Optional[str] = None) -> Dict[str, Any]:
        svc = DeviceAllocationService(self.db, self.actor)
        return svc.return_device(device_id, note=note)

    def bulk_allocate(
        self,
        device_ids: List[str],
        target_org_id: str,
        note: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        svc = DeviceAllocationService(self.db, self.actor)
        return svc.bulk_allocate(device_ids, target_org_id, note=note, idempotency_key=idempotency_key)

    # ── Import ───────────────────────────────────────────────────────────────

    def import_csv(self, csv_content: str, dry_run: bool = False) -> Dict[str, Any]:
        if self._role not in {UserRole.SUPER_ADMIN, UserRole.PANEL_MANUFACTURER}:
            raise HTTPException(status_code=403, detail="IMPORT_FORBIDDEN: only SUPER_ADMIN and PANEL_MANUFACTURER may import devices")
        svc = DeviceImportService(self.db, self.actor)
        return svc.import_csv(csv_content, dry_run=dry_run)

    # ── History ──────────────────────────────────────────────────────────────

    def get_device_history(self, device_id: str) -> Dict[str, Any]:
        pump = self._repo.find_by_id(device_id)
        if not pump:
            raise HTTPException(status_code=404, detail="DEVICE_NOT_FOUND")
        audit = self._repo.get_audit_events(device_id, limit=100)
        alloc = self._repo.get_org_allocation_history(device_id)
        panels = self._repo.get_panel_history(device_id)
        return {
            "device_id": device_id,
            "lifecycle_state": pump.lifecycle_state,
            "audit_events": audit,
            "allocation_history": alloc,
            "panel_history": panels,
        }

    def get_ownership_history(self, device_id: str) -> Dict[str, Any]:
        pump = self._repo.find_by_id(device_id)
        if not pump:
            raise HTTPException(status_code=404, detail="DEVICE_NOT_FOUND")
        org_chain = self._repo.get_org_allocation_history(device_id)
        user_chain = self._repo.get_user_allocation_history(device_id)
        current_org = None
        if pump.org_id:
            o = self.db.query(Organisation).filter(Organisation.id == pump.org_id).first()
            if o:
                current_org = {"id": str(o.id), "name": o.name, "type": o.type}
        return {
            "device_id": device_id,
            "current_org": current_org,
            "lifecycle_state": pump.lifecycle_state,
            "org_allocation_chain": org_chain,
            "user_allocation_chain": user_chain,
        }

    # ── Panel binding ────────────────────────────────────────────────────────

    def bind_panel(
        self,
        device_id: str,
        panel_serial: str,
        motor_rating: Optional[str] = None,
        starter_type: Optional[str] = None,
        pump_make: Optional[str] = None,
        pump_model: Optional[str] = None,
        note: Optional[str] = None,
    ) -> Dict[str, Any]:
        if self._role not in {UserRole.SUPER_ADMIN, UserRole.PANEL_MANUFACTURER, UserRole.DISTRIBUTOR, UserRole.DEALER}:
            raise HTTPException(status_code=403, detail="PANEL_BIND_FORBIDDEN")

        pump = self._repo.find_by_id(device_id)
        if not pump:
            raise HTTPException(status_code=404, detail="DEVICE_NOT_FOUND")

        panel_serial = panel_serial.strip()
        if not panel_serial:
            raise HTTPException(status_code=422, detail="PANEL_SERIAL_REQUIRED")

        # Check for existing active binding on a DIFFERENT device
        existing = self.db.query(PanelBindingHistory).filter(
            PanelBindingHistory.panel_serial == panel_serial,
            PanelBindingHistory.unbound_at.is_(None),
        ).first()
        if existing and existing.device_id != device_id:
            raise HTTPException(
                status_code=409,
                detail=f"PANEL_ALREADY_BOUND: panel_serial '{panel_serial}' is already bound to device '{existing.device_id}'",
            )

        # Close any active binding on this device
        old_binding = self.db.query(PanelBindingHistory).filter(
            PanelBindingHistory.device_id == device_id,
            PanelBindingHistory.unbound_at.is_(None),
        ).first()
        if old_binding:
            old_binding.unbound_at = datetime.now(timezone.utc)
            old_binding.unbound_by = self.actor.id

        # Write new binding
        binding = PanelBindingHistory(
            device_id=device_id,
            panel_serial=panel_serial,
            motor_rating=motor_rating,
            starter_type=starter_type,
            pump_make=pump_make,
            pump_model=pump_model,
            bound_by=self.actor.id,
            note=note,
        )
        self.db.add(binding)

        # Update pump inline fields (backward compat)
        before = {"panel_serial": pump.panel_serial}
        pump.panel_serial = panel_serial
        if motor_rating is not None:
            pump.motor_rating = motor_rating
        if starter_type is not None:
            pump.starter_type = starter_type
        if pump_make is not None:
            pump.pump_make = pump_make
        if pump_model is not None:
            pump.pump_model = pump_model

        self.db.add(AuditLog(
            actor_id=self.actor.id,
            actor_role=self.actor.role,
            entity_type="DEVICE",
            entity_id=device_id,
            action="DEVICE_PANEL_BOUND",
            before_json=before,
            after_json={"panel_serial": panel_serial},
        ))

        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            raise HTTPException(status_code=409, detail="PANEL_SERIAL_CONFLICT: panel serial already bound to another device")

        self.db.refresh(pump)
        return {
            "device_id": device_id,
            "panel_serial": pump.panel_serial,
            "motor_rating": pump.motor_rating,
            "starter_type": pump.starter_type,
            "pump_make": pump.pump_make,
            "pump_model": pump.pump_model,
            "bound_at": binding.bound_at.isoformat(),
        }

    # ── Export ───────────────────────────────────────────────────────────────

    def export_csv(
        self,
        q: Optional[str] = None,
        state: Optional[str] = None,
    ) -> str:
        """
        Generates a scoped CSV export of device inventory.
        Respects tenant isolation — never exports outside actor's scope.
        """
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "serial", "name", "lifecycle_state", "status",
            "org_id", "firmware_version", "panel_serial",
            "supply_type", "hp_rating", "created_at", "last_seen_at",
        ])
        for batch in self._repo.iter_export(q=q, state=state):
            for pump in batch:
                writer.writerow([
                    pump.id, pump.name, pump.lifecycle_state, pump.status,
                    str(pump.org_id) if pump.org_id else "",
                    pump.firmware_version or "",
                    pump.panel_serial or "",
                    pump.supply_type, float(pump.hp_rating) if pump.hp_rating else "",
                    pump.created_at.isoformat() if pump.created_at else "",
                    pump.last_seen_at.isoformat() if pump.last_seen_at else "",
                ])
        return output.getvalue()

    # ── Formatting ───────────────────────────────────────────────────────────

    def _format_device(self, pump: Pump, include_sensitive: bool = False) -> Dict[str, Any]:
        from datetime import timedelta
        last_seen = pump.last_seen_at
        if last_seen:
            if last_seen.tzinfo is None:
                last_seen = last_seen.replace(tzinfo=timezone.utc)
            from app.config import settings
            age = (datetime.now(timezone.utc) - last_seen).total_seconds()
            connectivity = "ONLINE" if age <= settings.OFFLINE_AFTER_SECONDS else "OFFLINE"
        else:
            connectivity = "UNKNOWN"

        org = None
        if pump.org_id:
            o = self.db.query(Organisation).filter(Organisation.id == pump.org_id).first()
            if o:
                org = {"id": str(o.id), "name": o.name, "type": o.type}

        end_user = None
        if pump.owner_user_id:
            u = self.db.query(User).filter(User.id == pump.owner_user_id).first()
            if u and (u.role in ("customer", "END_USER")):
                end_user = {"id": str(u.id), "name": u.full_name or u.phone_number}

        d: Dict[str, Any] = {
            "id": pump.id,
            "serial": pump.id,
            "name": pump.name,
            "lifecycle_state": pump.lifecycle_state or "MANUFACTURED",
            "allowed_transitions": sorted(
                DeviceLifecycleService(self.db).get_allowed_transitions(pump.lifecycle_state or "MANUFACTURED")
            ),
            "status": pump.status,
            "connectivity": connectivity,
            "org": org,
            "end_user": end_user,
            "supply_type": pump.supply_type,
            "hp_rating": float(pump.hp_rating) if pump.hp_rating else None,
            "firmware_version": pump.firmware_version,
            "panel_serial": pump.panel_serial,
            "motor_rating": pump.motor_rating,
            "starter_type": pump.starter_type,
            "pump_make": pump.pump_make,
            "pump_model": pump.pump_model,
            "latitude": float(pump.latitude) if pump.latitude else None,
            "longitude": float(pump.longitude) if pump.longitude else None,
            "warranty_start_date": pump.warranty_start_date.isoformat() if pump.warranty_start_date else None,
            "warranty_period_months": pump.warranty_period_months,
            "subscription_expires_at": pump.subscription_expires_at.isoformat() if pump.subscription_expires_at else None,
            "last_seen_at": last_seen.isoformat() if pump.last_seen_at else None,
            "created_at": pump.created_at.isoformat() if pump.created_at else None,
            "supports_command_ack": pump.supports_command_ack,
        }
        # Never expose secrets
        for field in DEVICE_SECRET_FIELDS:
            d.pop(field, None)
        return d
'''

for path, content in files.items():
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"WRITTEN: {os.path.relpath(path, BASE)}")

print("Part 3 done.")
