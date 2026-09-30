"""
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
