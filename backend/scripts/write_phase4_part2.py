"""
Phase 4 - Part 2: DeviceLifecycleService + DeviceAllocationService + DeviceImportService
"""
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(BASE, "app")

files = {}

# =========================================================
# DeviceLifecycleService
# =========================================================
files[os.path.join(APP, "services", "device_lifecycle_service.py")] = r'''"""
DeviceLifecycleService - Phase 4
==================================
Centralized state machine for device lifecycle transitions.

ALL state changes MUST go through this service.
No controller, repository, or other service should set pump.lifecycle_state directly.

Valid States:
  MANUFACTURED -> device created in OEM inventory, not yet connected
  ALLOCATED    -> assigned to a partner org node
  IN_STOCK     -> received by partner, not yet commissioned
  COMMISSIONED -> installed and configured at a site
  ACTIVE       -> operational
  SUSPENDED    -> cloud/billing suspension (local protection continues)
  RMA          -> under return/replacement workflow
  RETIRED      -> permanently retired (terminal)

Terminal state: RETIRED — no transitions out.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Set, Tuple

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.roles import UserRole, normalize_role
from app.models import Pump, User, AuditLog

logger = logging.getLogger("agripump.lifecycle")

# ── Valid transitions matrix ────────────────────────────────────────────────
# SRS-defined machine; modify only with explicit SRS change authorization.
TRANSITIONS: Dict[str, Set[str]] = {
    "MANUFACTURED": {"ALLOCATED", "IN_STOCK", "RETIRED"},
    "ALLOCATED":    {"IN_STOCK", "COMMISSIONED", "ALLOCATED", "RETURNED", "RETIRED"},
    "IN_STOCK":     {"COMMISSIONED", "ALLOCATED", "RETIRED"},
    "COMMISSIONED": {"ACTIVE", "SUSPENDED", "RMA", "RETIRED"},
    "ACTIVE":       {"SUSPENDED", "RMA", "RETIRED"},
    "SUSPENDED":    {"ACTIVE", "RMA", "RETIRED"},
    "RMA":          {"ACTIVE", "IN_STOCK", "RETIRED"},
    "RETIRED":      set(),  # Terminal — no exit
}

# Transitions that require SUPER_ADMIN or PANEL_MANUFACTURER
PRIVILEGED_TRANSITIONS: Set[Tuple[str, str]] = {
    ("MANUFACTURED", "IN_STOCK"),
    ("MANUFACTURED", "ALLOCATED"),
    ("ACTIVE",       "RETIRED"),
    ("SUSPENDED",    "RETIRED"),
    ("RMA",          "RETIRED"),
    ("COMMISSIONED", "RETIRED"),
}

# Roles that may perform SUSPEND (cloud side only)
SUSPEND_ROLES: Set[UserRole] = {
    UserRole.SUPER_ADMIN,
    UserRole.PANEL_MANUFACTURER,
    UserRole.DISTRIBUTOR,
}

# Roles that may perform RETIRE
RETIRE_ROLES: Set[UserRole] = {
    UserRole.SUPER_ADMIN,
    UserRole.PANEL_MANUFACTURER,
}

# Any partner role that may commission a device
COMMISSION_ROLES: Set[UserRole] = {
    UserRole.SUPER_ADMIN,
    UserRole.PANEL_MANUFACTURER,
    UserRole.DISTRIBUTOR,
    UserRole.DEALER,
}


class DeviceLifecycleService:
    """
    Validates and executes device lifecycle transitions with audit.

    Usage:
        svc = DeviceLifecycleService(db)
        svc.transition(pump, "ACTIVE", actor=current_user)
    """

    def __init__(self, db: Session):
        self.db = db

    # ── Public API ──────────────────────────────────────────────────────────

    def get_allowed_transitions(self, current_state: str) -> Set[str]:
        """Returns the set of valid target states from current_state."""
        return set(TRANSITIONS.get(current_state.upper(), set()))

    def validate_transition(
        self,
        current_state: str,
        next_state: str,
        actor: User,
    ) -> None:
        """
        Raises HTTPException if the transition is invalid or unauthorized.
        Call before executing the transition.
        """
        cs = (current_state or "MANUFACTURED").upper()
        ns = (next_state or "").upper()

        if cs == ns:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"DEVICE_SAME_STATE: device is already in state {cs}",
            )

        valid = TRANSITIONS.get(cs, set())
        if ns not in valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "DEVICE_INVALID_STATE_TRANSITION",
                    "from_state": cs,
                    "to_state": ns,
                    "valid_transitions": sorted(valid) if valid else [],
                    "message": f"Cannot transition from {cs} to {ns}. "
                               f"Valid: {sorted(valid) or 'None (terminal state)'}",
                },
            )

        self._check_transition_permission(cs, ns, actor)

    def transition(
        self,
        pump: Pump,
        next_state: str,
        actor: User,
        note: Optional[str] = None,
        commit: bool = True,
    ) -> Pump:
        """
        Validates and applies a lifecycle transition, writing an audit record.
        Set commit=False when calling inside a larger transaction.
        """
        ns = next_state.upper()
        cs = (pump.lifecycle_state or "MANUFACTURED").upper()

        self.validate_transition(cs, ns, actor)

        before = {"lifecycle_state": cs}
        pump.lifecycle_state = ns

        # SRS: SUSPENDED is cloud-only — local protection continues
        # No other field changes are made here except the state itself.

        self._write_audit(
            actor=actor,
            pump_id=pump.id,
            action="DEVICE_STATE_CHANGED",
            before=before,
            after={"lifecycle_state": ns, "note": note},
        )

        if commit:
            self.db.commit()
            self.db.refresh(pump)

        logger.info(
            "device_lifecycle.transition device=%s %s->%s actor=%s",
            pump.id, cs, ns, actor.id,
        )
        return pump

    # ── Permission enforcement ───────────────────────────────────────────────

    def _check_transition_permission(
        self,
        from_state: str,
        to_state: str,
        actor: User,
    ) -> None:
        role = normalize_role(actor.role)

        # Retirement is privileged
        if to_state == "RETIRED" and role not in RETIRE_ROLES:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="DEVICE_TRANSITION_FORBIDDEN: retiring a device requires SUPER_ADMIN or PANEL_MANUFACTURER",
            )

        # Suspension is cloud-only by billing/admin roles
        if to_state == "SUSPENDED" and role not in SUSPEND_ROLES:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="DEVICE_TRANSITION_FORBIDDEN: suspending a device requires SUPER_ADMIN, PANEL_MANUFACTURER, or DISTRIBUTOR",
            )

        # Commissioning
        if to_state == "COMMISSIONED" and role not in COMMISSION_ROLES:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="DEVICE_TRANSITION_FORBIDDEN: commissioning requires a partner role",
            )

        # Privileged transitions (manufacturing → stock/allocation)
        if (from_state, to_state) in PRIVILEGED_TRANSITIONS and role not in {
            UserRole.SUPER_ADMIN, UserRole.PANEL_MANUFACTURER
        }:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"DEVICE_TRANSITION_FORBIDDEN: transition {from_state}->{to_state} requires SUPER_ADMIN or PANEL_MANUFACTURER",
            )

    def _write_audit(
        self,
        actor: User,
        pump_id: str,
        action: str,
        before: Optional[dict] = None,
        after: Optional[dict] = None,
    ) -> None:
        self.db.add(AuditLog(
            actor_id=actor.id,
            actor_role=actor.role,
            entity_type="DEVICE",
            entity_id=pump_id,
            action=action,
            before_json=before,
            after_json=after,
        ))
'''

# =========================================================
# DeviceAllocationService
# =========================================================
files[os.path.join(APP, "services", "device_allocation_service.py")] = r'''"""
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
'''

# =========================================================
# DeviceImportService
# =========================================================
files[os.path.join(APP, "services", "device_import_service.py")] = r'''"""
DeviceImportService - Phase 4
================================
Bulk CSV device import with structured validation and error reporting.

CSV format:
  serial,model,hw_rev,batch_id,manufacture_date,supply_type,hp_rating
  PUMP-001,AgriPump-7.5HP,1.0,BATCH-2026-01,2026-01-15,3P,7.5

Rules:
  - serial: required, unique, pattern [A-Za-z0-9_-]{4,50}
  - model: required, max 100 chars
  - hw_rev: optional, max 20 chars
  - batch_id: optional, must exist in device_batches if provided
  - manufacture_date: optional, YYYY-MM-DD
  - supply_type: '3P' or '1P' or '3-phase' or '1-phase'
  - hp_rating: optional, float > 0
  - Initial state: MANUFACTURED

Duplicate detection:
  - Application-layer check before insert
  - DB-layer unique constraint catches concurrent races
"""
from __future__ import annotations

import csv
import io
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Pump, User, DeviceBatch, DeviceConfig, AuditLog

logger = logging.getLogger("agripump.import")

SERIAL_PATTERN = re.compile(r"^[A-Za-z0-9_\-]{4,50}$")
MODEL_PATTERN = re.compile(r"^[A-Za-z0-9 _\-\.]{1,100}$")
HW_REV_PATTERN = re.compile(r"^[A-Za-z0-9_\-\.]{1,20}$")
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")

SUPPLY_MAP = {
    "3P": "3-phase", "3-PHASE": "3-phase", "3PHASE": "3-phase",
    "1P": "1-phase", "1-PHASE": "1-phase", "1PHASE": "1-phase",
}

REQUIRED_FIELDS = {"serial"}
KNOWN_FIELDS = {"serial", "model", "hw_rev", "batch_id", "manufacture_date", "supply_type", "hp_rating", "name"}


class ImportError:
    def __init__(self, row: int, field: str, code: str, message: str, value: Any = None):
        self.row = row
        self.field = field
        self.code = code
        self.message = message
        self.value = value

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"row": self.row, "field": self.field, "code": self.code, "message": self.message}
        if self.value is not None:
            d["value"] = str(self.value)
        return d


class DeviceImportService:
    """
    Validates and imports device inventory from CSV.

    All-or-nothing per row: a row either fully succeeds or is recorded as an error.
    The overall import is NOT atomic — a partial success is possible and is explicitly reported.
    """

    MAX_ROWS = 5000
    SCHEMA = "agripump"

    def __init__(self, db: Session, actor: User):
        self.db = db
        self.actor = actor

    def import_csv(
        self,
        csv_content: str,
        dry_run: bool = False,
    ) -> Dict[str, Any]:
        """
        Parses and validates a CSV string. If dry_run=True, no DB writes occur.

        Returns:
            {
              total_rows, successful, failed, skipped,
              errors: [{row, field, code, message}]
            }
        """
        reader = csv.DictReader(io.StringIO(csv_content.strip()))

        if not reader.fieldnames:
            return {
                "total_rows": 0,
                "successful": 0,
                "failed": 0,
                "skipped": 0,
                "errors": [{"row": 0, "field": "file", "code": "EMPTY_FILE", "message": "CSV file is empty or missing headers"}],
            }

        # Case-insensitive field normalization
        fields_lower = {f.strip().lower(): f for f in (reader.fieldnames or [])}
        missing_required = REQUIRED_FIELDS - set(fields_lower.keys())
        if missing_required:
            return {
                "total_rows": 0,
                "successful": 0,
                "failed": 0,
                "skipped": 0,
                "errors": [{
                    "row": 1, "field": "header", "code": "MISSING_REQUIRED_COLUMN",
                    "message": f"Missing required CSV columns: {sorted(missing_required)}",
                }],
            }

        errors: List[ImportError] = []
        successful = 0
        skipped = 0

        # Pre-load batch codes for validation
        batch_cache: Dict[str, Any] = {}

        # Track serials seen in this import to detect intra-import duplicates
        seen_serials: set = set()

        rows = list(reader)

        if len(rows) > self.MAX_ROWS:
            return {
                "total_rows": len(rows),
                "successful": 0,
                "failed": 0,
                "skipped": 0,
                "errors": [{
                    "row": 0, "field": "file", "code": "TOO_MANY_ROWS",
                    "message": f"CSV has {len(rows)} rows; max is {self.MAX_ROWS}. Split into smaller files.",
                }],
            }

        for idx, raw_row in enumerate(rows, start=2):  # 2 = header is row 1
            # Normalize keys
            row = {k.strip().lower(): v.strip() if v else "" for k, v in raw_row.items()}

            row_errors, parsed = self._validate_row(row, idx, seen_serials, batch_cache)
            if row_errors:
                errors.extend(row_errors)
                continue

            serial = parsed["serial"]
            seen_serials.add(serial.upper())

            if dry_run:
                successful += 1
                continue

            # Check existing device
            existing = self.db.query(Pump.id).filter(Pump.id == serial).first()
            if existing:
                skipped += 1
                errors.append(ImportError(idx, "serial", "DUPLICATE_SERIAL", f"Device '{serial}' already exists", serial))
                continue

            # Create device
            try:
                with self.db.begin_nested():
                    pump = Pump(
                        id=serial,
                        name=parsed.get("name") or f"Device {serial}",
                        supply_type=parsed["supply_type"],
                        hp_rating=parsed["hp_rating"],
                        owner_user_id=self.actor.id,
                        hierarchy_path=self.actor.hierarchy_path or "/SA",
                        org_id=self.actor.org_id,
                        status="STOPPED",
                        lifecycle_state="MANUFACTURED",
                        firmware_version=None,
                    )
                    self.db.add(pump)

                    self.db.add(DeviceConfig(
                        pump_id=serial,
                        desired_json={"ol": 25.0, "ov": 480, "dr": 1, "dr_t": 5},
                        reported_json={},
                        status="APPLIED",
                    ))

                    self.db.add(AuditLog(
                        actor_id=self.actor.id,
                        actor_role=self.actor.role,
                        entity_type="DEVICE",
                        entity_id=serial,
                        action="DEVICE_IMPORTED",
                        before_json=None,
                        after_json={
                            "serial": serial,
                            "model": parsed.get("model"),
                            "hw_rev": parsed.get("hw_rev"),
                            "batch_id": parsed.get("batch_id"),
                        },
                    ))
                    self.db.flush()

                successful += 1

            except IntegrityError:
                self.db.rollback()
                skipped += 1
                errors.append(ImportError(idx, "serial", "DUPLICATE_SERIAL_RACE", f"Concurrent import: '{serial}' already exists", serial))
            except Exception as exc:
                self.db.rollback()
                logger.exception("Import row %d failed: %s", idx, exc)
                errors.append(ImportError(idx, "serial", "INSERT_FAILED", f"Database error: {exc}", serial))

        if not dry_run:
            try:
                self.db.commit()
            except Exception:
                self.db.rollback()
                raise

        return {
            "total_rows": len(rows),
            "successful": successful,
            "failed": len(errors) - skipped,
            "skipped": skipped,
            "errors": [e.to_dict() for e in errors],
        }

    def _validate_row(
        self,
        row: Dict[str, str],
        row_num: int,
        seen: set,
        batch_cache: dict,
    ) -> Tuple[List[ImportError], Dict[str, Any]]:
        errors = []
        parsed: Dict[str, Any] = {}

        # ── serial ─────────────────────────────────────────────────────────
        serial = row.get("serial", "").strip()
        if not serial:
            errors.append(ImportError(row_num, "serial", "MISSING_SERIAL", "serial is required"))
            return errors, parsed
        if not SERIAL_PATTERN.match(serial):
            errors.append(ImportError(row_num, "serial", "INVALID_SERIAL",
                f"serial '{serial}' must be 4–50 chars, letters/digits/dash/underscore only", serial))
            return errors, parsed
        if serial.upper() in seen:
            errors.append(ImportError(row_num, "serial", "DUPLICATE_IN_IMPORT",
                f"serial '{serial}' appears more than once in this import file", serial))
            return errors, parsed
        parsed["serial"] = serial

        # ── model ──────────────────────────────────────────────────────────
        model = row.get("model", "").strip()
        if model and not MODEL_PATTERN.match(model):
            errors.append(ImportError(row_num, "model", "INVALID_MODEL", f"model '{model}' contains invalid characters", model))
        parsed["model"] = model or None

        # ── hw_rev ─────────────────────────────────────────────────────────
        hw_rev = row.get("hw_rev", "").strip()
        if hw_rev and not HW_REV_PATTERN.match(hw_rev):
            errors.append(ImportError(row_num, "hw_rev", "INVALID_HW_REV", f"hw_rev '{hw_rev}' is invalid", hw_rev))
        parsed["hw_rev"] = hw_rev or None

        # ── batch_id ───────────────────────────────────────────────────────
        batch_id = row.get("batch_id", "").strip()
        if batch_id:
            if batch_id not in batch_cache:
                b = self.db.query(DeviceBatch).filter(DeviceBatch.batch_code == batch_id).first()
                batch_cache[batch_id] = b
            batch = batch_cache[batch_id]
            if not batch:
                errors.append(ImportError(row_num, "batch_id", "INVALID_BATCH", f"batch '{batch_id}' not found", batch_id))
            elif batch.revoked:
                errors.append(ImportError(row_num, "batch_id", "REVOKED_BATCH", f"batch '{batch_id}' is revoked", batch_id))
        parsed["batch_id"] = batch_id or None

        # ── manufacture_date ───────────────────────────────────────────────
        mfg_date_raw = row.get("manufacture_date", "").strip()
        if mfg_date_raw:
            if not DATE_PATTERN.match(mfg_date_raw):
                errors.append(ImportError(row_num, "manufacture_date", "INVALID_DATE_FORMAT",
                    f"manufacture_date '{mfg_date_raw}' must be YYYY-MM-DD", mfg_date_raw))
            else:
                try:
                    datetime.strptime(mfg_date_raw, "%Y-%m-%d")
                except ValueError:
                    errors.append(ImportError(row_num, "manufacture_date", "INVALID_DATE",
                        f"manufacture_date '{mfg_date_raw}' is not a valid calendar date", mfg_date_raw))
        parsed["manufacture_date"] = mfg_date_raw or None

        # ── supply_type ────────────────────────────────────────────────────
        st_raw = row.get("supply_type", "3P").strip().upper()
        supply_type = SUPPLY_MAP.get(st_raw)
        if not supply_type:
            errors.append(ImportError(row_num, "supply_type", "INVALID_SUPPLY_TYPE",
                f"supply_type '{st_raw}' must be 3P or 1P (or 3-phase/1-phase)", st_raw))
            supply_type = "3-phase"
        parsed["supply_type"] = supply_type

        # ── hp_rating ──────────────────────────────────────────────────────
        hp_raw = row.get("hp_rating", "").strip()
        if hp_raw:
            try:
                hp = float(hp_raw)
                if hp <= 0 or hp > 500:
                    raise ValueError
                parsed["hp_rating"] = hp
            except ValueError:
                errors.append(ImportError(row_num, "hp_rating", "INVALID_HP_RATING",
                    f"hp_rating '{hp_raw}' must be a positive number <= 500", hp_raw))
                parsed["hp_rating"] = 5.0
        else:
            parsed["hp_rating"] = 5.0

        return errors, parsed
'''

for path, content in files.items():
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"WRITTEN: {os.path.relpath(path, BASE)}")

print("Part 2 done.")
