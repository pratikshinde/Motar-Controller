"""
Centralized Role, Organisation Type, and Status Definitions
Phase 2A: AgriPump SmartSpace Organisation Hierarchy & User/Role Data Model
"""
from enum import Enum
from typing import Dict, List, Optional, Set


class UserRole(str, Enum):
    SUPER_ADMIN = "SUPER_ADMIN"
    PANEL_MANUFACTURER = "PANEL_MANUFACTURER"
    DISTRIBUTOR = "DISTRIBUTOR"
    DEALER = "DEALER"
    SUPPORT_ENGINEER = "SUPPORT_ENGINEER"
    END_USER = "END_USER"


class OrgType(str, Enum):
    SUPERADMIN = "SUPERADMIN"
    MANUFACTURER = "MANUFACTURER"
    DISTRIBUTOR = "DISTRIBUTOR"
    DEALER = "DEALER"


class OrgStatus(str, Enum):
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    DISABLED = "DISABLED"


class UserStatus(str, Enum):
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    DISABLED = "DISABLED"
    INACTIVE = "INACTIVE"


class AuditAction(str, Enum):
    ORGANISATION_CREATED = "ORGANISATION_CREATED"
    ORGANISATION_UPDATED = "ORGANISATION_UPDATED"
    ORGANISATION_SUSPENDED = "ORGANISATION_SUSPENDED"
    ORGANISATION_ACTIVATED = "ORGANISATION_ACTIVATED"
    ORGANISATION_DELETED = "ORGANISATION_DELETED"
    USER_CREATED = "USER_CREATED"
    USER_UPDATED = "USER_UPDATED"
    USER_ROLE_CHANGED = "USER_ROLE_CHANGED"
    USER_SUSPENDED = "USER_SUSPENDED"
    USER_ACTIVATED = "USER_ACTIVATED"
    ORGANISATION_INVITATION_CREATED = "ORGANISATION_INVITATION_CREATED"


# Internal canonical DB strings for backward-compatibility with PostgreSQL RLS & existing queries
DB_ROLE_SUPER_ADMIN = "superadmin"
DB_ROLE_PANEL_MANUFACTURER = "manufacturer"
DB_ROLE_DISTRIBUTOR = "distributor"
DB_ROLE_DEALER = "dealer"
DB_ROLE_SUPPORT_ENGINEER = "support"
DB_ROLE_END_USER = "customer"

ROLE_TO_DB_MAP: Dict[UserRole, str] = {
    UserRole.SUPER_ADMIN: DB_ROLE_SUPER_ADMIN,
    UserRole.PANEL_MANUFACTURER: DB_ROLE_PANEL_MANUFACTURER,
    UserRole.DISTRIBUTOR: DB_ROLE_DISTRIBUTOR,
    UserRole.DEALER: DB_ROLE_DEALER,
    UserRole.SUPPORT_ENGINEER: DB_ROLE_SUPPORT_ENGINEER,
    UserRole.END_USER: DB_ROLE_END_USER,
}

DB_TO_ROLE_MAP: Dict[str, UserRole] = {v: k for k, v in ROLE_TO_DB_MAP.items()}

ROLE_ALIASES: Dict[str, UserRole] = {
    "SUPER_ADMIN": UserRole.SUPER_ADMIN,
    "SUPERADMIN": UserRole.SUPER_ADMIN,
    "ROOT": UserRole.SUPER_ADMIN,
    "PANEL_MANUFACTURER": UserRole.PANEL_MANUFACTURER,
    "MANUFACTURER": UserRole.PANEL_MANUFACTURER,
    "DISTRIBUTOR": UserRole.DISTRIBUTOR,
    "DEALER": UserRole.DEALER,
    "SUPPORT_ENGINEER": UserRole.SUPPORT_ENGINEER,
    "SUPPORT": UserRole.SUPPORT_ENGINEER,
    "END_USER": UserRole.END_USER,
    "CUSTOMER": UserRole.END_USER,
    "FARMER": UserRole.END_USER,
}

ORG_TYPE_ALIASES: Dict[str, OrgType] = {
    "SUPERADMIN": OrgType.SUPERADMIN,
    "SUPER_ADMIN": OrgType.SUPERADMIN,
    "ROOT": OrgType.SUPERADMIN,
    "MANUFACTURER": OrgType.MANUFACTURER,
    "PANEL_MANUFACTURER": OrgType.MANUFACTURER,
    "DISTRIBUTOR": OrgType.DISTRIBUTOR,
    "DEALER": OrgType.DEALER,
}

MAX_DEALER_DEPTH = 6

# Allowed parent organisation -> child organisation types
ALLOWED_CHILD_ORG_TYPES: Dict[OrgType, Set[OrgType]] = {
    OrgType.SUPERADMIN: {OrgType.MANUFACTURER},
    OrgType.MANUFACTURER: {OrgType.DISTRIBUTOR},
    OrgType.DISTRIBUTOR: {OrgType.DEALER},
    OrgType.DEALER: {OrgType.DEALER},
}

# Allowed caller role -> child organisation types they may manage/create
ALLOWED_ROLE_CREATE_ORG: Dict[UserRole, Set[OrgType]] = {
    UserRole.SUPER_ADMIN: {OrgType.MANUFACTURER, OrgType.DISTRIBUTOR, OrgType.DEALER},
    UserRole.PANEL_MANUFACTURER: {OrgType.DISTRIBUTOR, OrgType.DEALER},
    UserRole.DISTRIBUTOR: {OrgType.DEALER},
    UserRole.DEALER: {OrgType.DEALER},
    UserRole.SUPPORT_ENGINEER: set(),
    UserRole.END_USER: set(),
}

# Allowed caller role -> roles they can assign/create
ALLOWED_CHILD_USER_ROLES: Dict[UserRole, Set[UserRole]] = {
    UserRole.SUPER_ADMIN: {
        UserRole.PANEL_MANUFACTURER,
        UserRole.DISTRIBUTOR,
        UserRole.DEALER,
        UserRole.SUPPORT_ENGINEER,
        UserRole.END_USER,
    },
    UserRole.PANEL_MANUFACTURER: {
        UserRole.DISTRIBUTOR,
        UserRole.DEALER,
        UserRole.SUPPORT_ENGINEER,
        UserRole.END_USER,
    },
    UserRole.DISTRIBUTOR: {
        UserRole.DEALER,
        UserRole.END_USER,
    },
    UserRole.DEALER: {
        UserRole.DEALER,
        UserRole.END_USER,
    },
    UserRole.SUPPORT_ENGINEER: set(),
    UserRole.END_USER: set(),
}

# Compatible role for organisation types
COMPATIBLE_ORG_ROLES: Dict[OrgType, Set[UserRole]] = {
    OrgType.SUPERADMIN: {UserRole.SUPER_ADMIN, UserRole.SUPPORT_ENGINEER},
    OrgType.MANUFACTURER: {UserRole.PANEL_MANUFACTURER, UserRole.SUPPORT_ENGINEER},
    OrgType.DISTRIBUTOR: {UserRole.DISTRIBUTOR},
    OrgType.DEALER: {UserRole.DEALER, UserRole.END_USER},
}


def normalize_role(role_name: Optional[Any]) -> UserRole:
    """Resolves any string representation or alias into canonical UserRole enum."""
    if isinstance(role_name, UserRole):
        return role_name
    if not role_name:
        return UserRole.END_USER
    val = role_name.value if hasattr(role_name, "value") else str(role_name)
    clean = val.strip().upper()
    if clean.startswith("USERROLE."):
        clean = clean[len("USERROLE."):]
    return ROLE_ALIASES.get(clean, UserRole.END_USER)


def to_db_role(role: UserRole | str) -> str:
    """Converts a role to the canonical lowercase database string."""
    enum_role = normalize_role(role)
    return ROLE_TO_DB_MAP.get(enum_role, DB_ROLE_END_USER)


def normalize_org_type(org_type: Optional[Any]) -> OrgType:
    """Resolves any string representation into canonical OrgType enum."""
    if isinstance(org_type, OrgType):
        return org_type
    if not org_type:
        return OrgType.DEALER
    val = org_type.value if hasattr(org_type, "value") else str(org_type)
    clean = val.strip().upper()
    if clean.startswith("ORGTYPE."):
        clean = clean[len("ORGTYPE."):]
    if clean in ORG_TYPE_ALIASES:
        return ORG_TYPE_ALIASES[clean]
    raise ValueError(f"Unknown organisation type: {org_type}")



def normalize_org_status(status_str: Optional[Any]) -> OrgStatus:
    if isinstance(status_str, OrgStatus):
        return status_str
    if not status_str:
        return OrgStatus.ACTIVE
    val = status_str.value if hasattr(status_str, "value") else str(status_str)
    clean = val.strip().upper()
    if clean in OrgStatus.__members__:
        return OrgStatus(clean)
    return OrgStatus.ACTIVE

