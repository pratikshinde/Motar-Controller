"""
Centralized Permission and Authorization Engine
Enforces client-specific organisation hierarchy, role permissions,
dealer depth limits (max 6 nested dealer levels), and tenant/subtree boundaries.
"""
from typing import Any, Optional, Set
import uuid
from app.models.user import User
from app.models.organisation import Organisation
from app.core.scope import in_subtree, path_in_scope

from app.core.roles import (
    UserRole, OrgType, OrgStatus, AuditAction,
    ROLE_TO_DB_MAP, DB_TO_ROLE_MAP, ROLE_ALIASES,
    ALLOWED_CHILD_USER_ROLES, MAX_DEALER_DEPTH,
    to_db_role, normalize_role as normalize_enum_role
)

# Normalized role constants (kept for backward compatibility with RLS & existing callers)
ROLE_SUPER_ADMIN = "superadmin"
ROLE_PANEL_MANUFACTURER = "manufacturer"
ROLE_DISTRIBUTOR = "distributor"
ROLE_DEALER = "dealer"
ROLE_SUPPORT_ENGINEER = "support"
ROLE_END_USER = "customer"

ALL_ROLES = {
    ROLE_SUPER_ADMIN,
    ROLE_PANEL_MANUFACTURER,
    ROLE_DISTRIBUTOR,
    ROLE_DEALER,
    ROLE_SUPPORT_ENGINEER,
    ROLE_END_USER,
}

def normalize_role(role_name: Optional[str]) -> str:
    """Returns canonical DB role string ('superadmin', 'manufacturer', etc.)"""
    if not role_name:
        return ROLE_END_USER
    clean = str(role_name).strip().upper()
    enum_role = ROLE_ALIASES.get(clean)
    if enum_role:
        return ROLE_TO_DB_MAP.get(enum_role, ROLE_END_USER)
    return str(role_name).strip().lower()

def is_super_admin(user: User) -> bool:
    if not user:
        return False
    return normalize_role(user.role) == ROLE_SUPER_ADMIN

# Hierarchical creation rules: who is authorized to create/invite which roles
ALLOWED_CHILD_ROLES = {
    ROLE_SUPER_ADMIN: {
        ROLE_PANEL_MANUFACTURER,
        ROLE_DISTRIBUTOR,
        ROLE_DEALER,
        ROLE_SUPPORT_ENGINEER,
        ROLE_END_USER,
    },
    ROLE_PANEL_MANUFACTURER: {
        ROLE_DISTRIBUTOR,
        ROLE_DEALER,
        ROLE_SUPPORT_ENGINEER,
        ROLE_END_USER,
    },
    ROLE_DISTRIBUTOR: {
        ROLE_DEALER,
        ROLE_END_USER,
    },
    ROLE_DEALER: {
        ROLE_DEALER,
        ROLE_END_USER,
    },
    ROLE_SUPPORT_ENGINEER: set(),
    ROLE_END_USER: set(),
}

def can_create_role(creator_role: str, target_role: str, current_dealer_depth: int = 0) -> bool:
    """
    Evaluates whether an actor with `creator_role` can create/invite an entity with `target_role`.
    Also enforces the maximum 6-level dealer hierarchy rule.
    """
    c_role = normalize_role(creator_role)
    t_role = normalize_role(target_role)

    # Super Admin cannot be created arbitrarily
    if t_role == ROLE_SUPER_ADMIN:
        return False

    allowed = ALLOWED_CHILD_ROLES.get(c_role, set())
    if t_role not in allowed:
        return False

    # Check dealer depth constraint
    if t_role == ROLE_DEALER:
        # If creator is already a dealer at level 6, a child dealer would be level 7 (forbidden!)
        if c_role == ROLE_DEALER and current_dealer_depth >= MAX_DEALER_DEPTH:
            return False

    return True

def can(actor: User, action: str, resource: Optional[Any] = None) -> bool:
    """
    Centralized authorization checker.
    Usage:
        can(user, "CREATE_MANUFACTURER")
        can(user, "CREATE_DISTRIBUTOR")
        can(user, "CREATE_DEALER")
        can(user, "INVITE_END_USER")
        can(user, "VIEW_DEVICE", device)
        can(user, "CONTROL_DEVICE", device)
        can(user, "MANAGE_FIRMWARE")
    """
    if not actor:
        return False

    is_active = actor.get("is_active", True) if isinstance(actor, dict) else getattr(actor, "is_active", True)
    if not is_active:
        return False

    account_status = actor.get("account_status", "") if isinstance(actor, dict) else getattr(actor, "account_status", "")
    status_val = actor.get("status", "") if isinstance(actor, dict) else getattr(actor, "status", "")
    if account_status == "SUSPENDED" or status_val == "SUSPENDED":
        return False

    raw_role = actor.get("role", "") if isinstance(actor, dict) else getattr(actor, "role", "")
    role = normalize_role(raw_role)

    # Super Admin has unrestricted access within platform boundaries
    if role == ROLE_SUPER_ADMIN:
        return True

    action = action.upper()

    if action == "CREATE_SUPER_ADMIN":
        return False

    if action == "CREATE_MANUFACTURER":
        return role == ROLE_SUPER_ADMIN

    if action == "CREATE_DISTRIBUTOR":
        return role in (ROLE_SUPER_ADMIN, ROLE_PANEL_MANUFACTURER)

    if action == "CREATE_DEALER":
        if role in (ROLE_SUPER_ADMIN, ROLE_PANEL_MANUFACTURER, ROLE_DISTRIBUTOR):
            return True
        if role == ROLE_DEALER:
            depth = actor.get("dealer_depth", 0) if isinstance(actor, dict) else getattr(actor, "dealer_depth", 0)
            return (depth or 0) < MAX_DEALER_DEPTH
        return False

    if action in ("INVITE_END_USER", "CREATE_END_USER"):
        return role in (ROLE_SUPER_ADMIN, ROLE_PANEL_MANUFACTURER, ROLE_DISTRIBUTOR, ROLE_DEALER)

    if action == "MANAGE_FIRMWARE":
        return role in (ROLE_SUPER_ADMIN, ROLE_PANEL_MANUFACTURER, ROLE_SUPPORT_ENGINEER)

    if action in ("VIEW_DEVICE", "CONTROL_DEVICE"):
        if resource is None:
            return True
        # If resource is a pump, verify tenant/subtree boundary
        pump = resource
        if hasattr(pump, "hierarchy_path") and actor.hierarchy_path:
            return path_in_scope(actor.hierarchy_path, pump.hierarchy_path)
        if hasattr(pump, "owner_user_id") and pump.owner_user_id == actor.id:
            return True
        return False

    if action == "CREATE_INVITATION":
        return role in (ROLE_SUPER_ADMIN, ROLE_PANEL_MANUFACTURER, ROLE_DISTRIBUTOR, ROLE_DEALER)

    # Fallback to checking role permissions table
    return False
