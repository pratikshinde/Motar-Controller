"""
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
