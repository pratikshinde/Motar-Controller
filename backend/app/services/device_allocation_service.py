"""
DeviceAllocationService - Phase 4
===================================
Handles all device allocation/reallocation/return operations.

Allocation model:
  - Devices are owned at the ORGANISATION level (pump.org_id)
  - User-level allocation (pump.owner_user_id) is maintained for backward compat
  - The authoritative org chain is in DeviceOrgAllocationLog
  - Allocation is idempotent via Idempotency-Key

Hierarchy rules (SRS):
  SUPER_ADMIN  -> any org
  MANUFACTURER -> DISTRIBUTOR, DEALER (in own subtree)
  DISTRIBUTOR  -> DEALER (in own subtree)
  DEALER       -> DEALER sub-dealer (in own subtree, depth <= MAX_DEALER_DEPTH)

Return rules:
  An org may return a device to its direct parent or to SUPER_ADMIN.
  Cross-sibling allocation is forbidden unless actor is SUPER_ADMIN.
"""
from __future__ import annotations

import logging
import uuid as _uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.roles import UserRole, normalize_role
from app.core.scope import path_in_scope
from app.models import Pump, User, Organisation, AllocationLog, AuditLog
from app.models.device_inventory import DeviceOrgAllocationLog
from app.services.device_lifecycle_service import DeviceLifecycleService

logger = logging.getLogger("agripump.allocation")

# States in which bulk allocation is valid (not yet live)
ALLOCATABLE_STATES = {"MANUFACTURED", "ALLOCATED", "IN_STOCK"}


class DeviceAllocationService:
    """
    Manages org-to-org device allocation with immutable chain-of-custody.
    All operations are transactional and idempotent.
    """

    def __init__(self, db: Session, actor: User):
        self.db = db
        self.actor = actor
        self._role = normalize_role(actor.role)
        self._lifecycle = DeviceLifecycleService(db)

    # ── Single device allocation ─────────────────────────────────────────────

    def allocate(
        self,
        device_id: str,
        target_org_id: str,
        note: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Allocates device_id to target_org_id.

        Validates:
          1. Actor authenticated
          2. Device exists and in scope
          3. Target org exists
          4. Target is a valid downstream node
          5. Lifecycle state permits allocation
          6. Device not already owned by target
          7. Idempotency: if same key already succeeded, return cached result
        """
        # Idempotency check
        if idempotency_key:
            existing = self._find_idempotent(device_id, idempotency_key)
            if existing:
                return {"idempotent": True, "log_id": existing.id, "device_id": device_id}

        # Load and scope-check device
        pump = self._load_device_in_scope(device_id)

        # Validate target org
        try:
            target_uuid = _uuid.UUID(target_org_id)
        except ValueError:
            raise HTTPException(status_code=422, detail="INVALID_ORG_ID: target_org_id is not a valid UUID")
        target_org = self.db.query(Organisation).filter(Organisation.id == target_uuid).first()
        if not target_org:
            raise HTTPException(status_code=404, detail="TARGET_ORG_NOT_FOUND")

        # Validate allocation direction
        self._validate_allocation_direction(pump, target_org)

        # Lifecycle state check
        curr_state = (pump.lifecycle_state or "MANUFACTURED").upper()
        if curr_state not in ALLOCATABLE_STATES and self._role != UserRole.SUPER_ADMIN:
            raise HTTPException(
                status_code=409,
                detail=f"DEVICE_NOT_ALLOCATABLE: device is {curr_state}; only MANUFACTURED/IN_STOCK/ALLOCATED devices can be allocated",
            )

        # Already at target
        if pump.org_id and str(pump.org_id) == str(target_uuid):
            raise HTTPException(status_code=409, detail="DEVICE_ALREADY_AT_TARGET: device is already owned by this org")

        # Execute transactional allocation
        return self._execute_allocation(
            pump, target_org,
            action="ALLOCATED",
            note=note,
            idempotency_key=idempotency_key,
        )

    def return_device(
        self,
        device_id: str,
        note: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Return a device to its parent org (or to OEM inventory if at root).

        DEALER -> DISTRIBUTOR
        DISTRIBUTOR -> MANUFACTURER
        MANUFACTURER -> OEM inventory (org_id=NULL)
        """
        pump = self._load_device_in_scope(device_id)
        if not pump.org_id:
            raise HTTPException(status_code=409, detail="DEVICE_NOT_ALLOCATED: device has no current org owner")

        current_org = self.db.query(Organisation).filter(Organisation.id == pump.org_id).first()
        if not current_org:
            raise HTTPException(status_code=409, detail="CURRENT_ORG_NOT_FOUND")

        # Validate the actor controls the current org or is SUPER_ADMIN
        if self._role != UserRole.SUPER_ADMIN:
            actor_org = self._get_actor_org()
            if not actor_org or not path_in_scope(str(actor_org.path), str(current_org.path)):
                raise HTTPException(
                    status_code=403,
                    detail="RETURN_FORBIDDEN: you do not control the device's current owner org",
                )

        # Find parent org
        parent_org = None
        if current_org.parent_id:
            parent_org = self.db.query(Organisation).filter(Organisation.id == current_org.parent_id).first()

        return self._execute_allocation(
            pump, parent_org,
            action="RETURNED",
            note=note,
        )

    # ── Bulk allocation ──────────────────────────────────────────────────────

    def bulk_allocate(
        self,
        device_ids: List[str],
        target_org_id: str,
        note: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Allocates multiple devices to target_org_id.

        Each device is processed independently (partial success allowed).
        Returns structured result with per-device outcomes.
        """
        # Validate target once
        try:
            target_uuid = _uuid.UUID(target_org_id)
        except ValueError:
            raise HTTPException(status_code=422, detail="INVALID_ORG_ID: target_org_id is not a valid UUID")
        target_org = self.db.query(Organisation).filter(Organisation.id == target_uuid).first()
        if not target_org:
            raise HTTPException(status_code=404, detail="TARGET_ORG_NOT_FOUND")

        results = []
        seen_ids = set()

        for raw_id in device_ids:
            device_id = (raw_id or "").strip()
            if not device_id or device_id in seen_ids:
                continue
            seen_ids.add(device_id)

            # Per-device idempotency key suffix
            per_device_key = f"{idempotency_key}:{device_id}" if idempotency_key else None
            if per_device_key:
                existing = self._find_idempotent(device_id, per_device_key)
                if existing:
                    results.append({"device_id": device_id, "success": True, "idempotent": True})
                    continue

            try:
                pump = self.db.query(Pump).filter(Pump.id == device_id).first()
                if not pump:
                    results.append({"device_id": device_id, "success": False, "code": "DEVICE_NOT_FOUND", "message": "Device not found"})
                    continue

                # Scope check
                if not self._device_in_scope(pump):
                    results.append({"device_id": device_id, "success": False, "code": "DEVICE_OUT_OF_SCOPE", "message": "Device not in your scope"})
                    continue

                curr_state = (pump.lifecycle_state or "MANUFACTURED").upper()
                if curr_state not in ALLOCATABLE_STATES and self._role != UserRole.SUPER_ADMIN:
                    results.append({
                        "device_id": device_id, "success": False,
                        "code": "DEVICE_NOT_ALLOCATABLE",
                        "message": f"Device is {curr_state}; only stock/allocated devices can be bulk-allocated",
                        "current_state": curr_state,
                    })
                    continue

                if pump.org_id and str(pump.org_id) == str(target_uuid):
                    results.append({"device_id": device_id, "success": False, "code": "ALREADY_AT_TARGET", "message": "Already owned by this org"})
                    continue

                with self.db.begin_nested():
                    self._do_allocation_write(pump, target_org, "ALLOCATED", note, per_device_key)

                results.append({"device_id": device_id, "success": True})

            except HTTPException as he:
                results.append({"device_id": device_id, "success": False, "code": "ALLOCATION_FAILED", "message": he.detail})
            except Exception as exc:
                logger.exception("bulk_allocate: device %s failed: %s", device_id, exc)
                results.append({"device_id": device_id, "success": False, "code": "INTERNAL_ERROR", "message": "Allocation failed"})

        self.db.commit()

        successful = sum(1 for r in results if r.get("success"))
        failed = len(results) - successful
        return {
            "total": len(results),
            "successful": successful,
            "failed": failed,
            "errors": [r for r in results if not r.get("success")],
            "results": results,
        }

    # ── Internal helpers ─────────────────────────────────────────────────────

    def _load_device_in_scope(self, device_id: str) -> Pump:
        pump = self.db.query(Pump).filter(Pump.id == device_id).first()
        if not pump:
            raise HTTPException(status_code=404, detail="DEVICE_NOT_FOUND")
        if not self._device_in_scope(pump):
            raise HTTPException(status_code=404, detail="DEVICE_NOT_FOUND")
        return pump

    def _device_in_scope(self, pump: Pump) -> bool:
        if self._role == UserRole.SUPER_ADMIN:
            return True
        actor_org = self._get_actor_org()
        if not actor_org:
            return False
        # Check via org_id membership
        if pump.org_id:
            pump_org = self.db.query(Organisation).filter(Organisation.id == pump.org_id).first()
            if pump_org and pump_org.path:
                return path_in_scope(str(actor_org.path), str(pump_org.path))
        # Fallback to hierarchy_path
        return path_in_scope(
            self.actor.hierarchy_path or "",
            pump.hierarchy_path or "",
        )

    def _get_actor_org(self) -> Optional[Organisation]:
        if not self.actor.org_id:
            return None
        return self.db.query(Organisation).filter(Organisation.id == self.actor.org_id).first()

    def _validate_allocation_direction(self, pump: Pump, target_org: Organisation) -> None:
        """
        Verify target is a valid downstream org the actor controls.
        SUPER_ADMIN can allocate to any org.
        """
        if self._role == UserRole.SUPER_ADMIN:
            return

        actor_org = self._get_actor_org()
        if not actor_org or not actor_org.path or not target_org.path:
            raise HTTPException(status_code=403, detail="ALLOCATION_FORBIDDEN: cannot resolve org scope")

        # Actor must control target (target is within actor's subtree)
        if not path_in_scope(str(actor_org.path), str(target_org.path)):
            raise HTTPException(
                status_code=403,
                detail="ALLOCATION_FORBIDDEN: target organisation is not in your subtree",
            )

        # Verify actor also controls device's current owner
        if pump.org_id and str(pump.org_id) != str(actor_org.id):
            current_org = self.db.query(Organisation).filter(Organisation.id == pump.org_id).first()
            if current_org and not path_in_scope(str(actor_org.path), str(current_org.path)):
                raise HTTPException(
                    status_code=403,
                    detail="ALLOCATION_FORBIDDEN: you do not control the device's current owner org",
                )

    def _execute_allocation(
        self,
        pump: Pump,
        target_org: Optional[Organisation],
        action: str,
        note: Optional[str],
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        with self.db.begin_nested():
            log = self._do_allocation_write(pump, target_org, action, note, idempotency_key)
        self.db.commit()
        self.db.refresh(pump)
        return {
            "device_id": pump.id,
            "action": action,
            "from_org_id": str(log.from_org_id) if log.from_org_id else None,
            "to_org_id": str(log.to_org_id) if log.to_org_id else None,
            "lifecycle_state": pump.lifecycle_state,
            "occurred_at": log.occurred_at.isoformat(),
            "log_id": log.id,
        }

    def _do_allocation_write(
        self,
        pump: Pump,
        target_org: Optional[Organisation],
        action: str,
        note: Optional[str],
        idempotency_key: Optional[str] = None,
    ) -> DeviceOrgAllocationLog:
        """Inner write within a savepoint. Does not commit."""
        from_org_id = pump.org_id
        to_org_id = target_org.id if target_org else None

        # Update device ownership
        pump.org_id = to_org_id
        if target_org:
            pump.hierarchy_path = str(target_org.path) if target_org.path else pump.hierarchy_path
            # Find primary user of target org for backward-compat owner_user_id
            target_user = self.db.query(User).filter(User.org_id == to_org_id).first()
            if target_user:
                pump.owner_user_id = target_user.id
        else:
            # Returned to OEM inventory
            pump.hierarchy_path = "/SA"

        # Advance lifecycle state if in stock
        curr_state = (pump.lifecycle_state or "MANUFACTURED").upper()
        if action == "ALLOCATED" and curr_state in ("MANUFACTURED", "IN_STOCK"):
            pump.lifecycle_state = "ALLOCATED"

        # Write legacy AllocationLog for backward compat
        self.db.add(AllocationLog(
            pump_id=pump.id,
            from_user_id=pump.owner_user_id,
            to_user_id=self.actor.id,
            actor_id=self.actor.id,
            note=note,
        ))

        # Write new org-level log
        log = DeviceOrgAllocationLog(
            device_id=pump.id,
            from_org_id=from_org_id,
            to_org_id=to_org_id,
            actor_id=self.actor.id,
            action=action,
            note=note,
            idempotency_key=idempotency_key,
        )
        self.db.add(log)

        # Audit
        self.db.add(AuditLog(
            actor_id=self.actor.id,
            actor_role=self.actor.role,
            entity_type="DEVICE",
            entity_id=pump.id,
            action=f"DEVICE_{action}",
            before_json={"org_id": str(from_org_id) if from_org_id else None},
            after_json={"org_id": str(to_org_id) if to_org_id else None, "note": note},
        ))

        self.db.flush()
        return log

    def _find_idempotent(
        self, device_id: str, key: str
    ) -> Optional[DeviceOrgAllocationLog]:
        return (
            self.db.query(DeviceOrgAllocationLog)
            .filter(
                DeviceOrgAllocationLog.device_id == device_id,
                DeviceOrgAllocationLog.idempotency_key == key,
            )
            .first()
        )
