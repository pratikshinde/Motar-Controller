"""
Centralized Permission Definitions and Role-to-Permission Mappings
Phase 2B: AgriPump SmartSpace Backend RBAC + Organisation Scoping
"""
from enum import Enum
from typing import Dict, Set, Union
from app.core.roles import UserRole, normalize_role


class Permission(str, Enum):
    # Dashboard
    VIEW_GLOBAL_DASHBOARD = "VIEW_GLOBAL_DASHBOARD"
    VIEW_SUBTREE_DASHBOARD = "VIEW_SUBTREE_DASHBOARD"

    # Organisations
    MANAGE_ORGANISATIONS = "MANAGE_ORGANISATIONS"
    CREATE_MANUFACTURER = "CREATE_MANUFACTURER"
    CREATE_DISTRIBUTOR = "CREATE_DISTRIBUTOR"
    CREATE_DEALER = "CREATE_DEALER"
    CREATE_END_USER = "CREATE_END_USER"

    # Users
    MANAGE_USERS = "MANAGE_USERS"
    SUSPEND_USER = "SUSPEND_USER"
    ACTIVATE_USER = "ACTIVATE_USER"

    # Devices
    VIEW_DEVICE = "VIEW_DEVICE"
    CONTROL_DEVICE = "CONTROL_DEVICE"
    CONFIGURE_DEVICE = "CONFIGURE_DEVICE"

    # Alerts
    VIEW_ALERTS = "VIEW_ALERTS"
    MANAGE_ALERT_RULES = "MANAGE_ALERT_RULES"

    # Firmware & OTA
    MANAGE_FIRMWARE = "MANAGE_FIRMWARE"
    CREATE_OTA_JOB = "CREATE_OTA_JOB"

    # RMA
    VIEW_RMA = "VIEW_RMA"
    MANAGE_RMA = "MANAGE_RMA"

    # Audit & Health
    VIEW_AUDIT_LOG = "VIEW_AUDIT_LOG"
    VIEW_SYSTEM_HEALTH = "VIEW_SYSTEM_HEALTH"


# Role to Permissions matrix
ROLE_PERMISSIONS: Dict[UserRole, Set[Permission]] = {
    UserRole.SUPER_ADMIN: {
        Permission.VIEW_GLOBAL_DASHBOARD,
        Permission.VIEW_SUBTREE_DASHBOARD,
        Permission.MANAGE_ORGANISATIONS,
        Permission.CREATE_MANUFACTURER,
        Permission.CREATE_DISTRIBUTOR,
        Permission.CREATE_DEALER,
        Permission.CREATE_END_USER,
        Permission.MANAGE_USERS,
        Permission.SUSPEND_USER,
        Permission.ACTIVATE_USER,
        Permission.VIEW_DEVICE,
        Permission.CONTROL_DEVICE,
        Permission.CONFIGURE_DEVICE,
        Permission.VIEW_ALERTS,
        Permission.MANAGE_ALERT_RULES,
        Permission.MANAGE_FIRMWARE,
        Permission.CREATE_OTA_JOB,
        Permission.VIEW_RMA,
        Permission.MANAGE_RMA,
        Permission.VIEW_AUDIT_LOG,
        Permission.VIEW_SYSTEM_HEALTH,
    },
    UserRole.PANEL_MANUFACTURER: {
        Permission.VIEW_SUBTREE_DASHBOARD,
        Permission.MANAGE_ORGANISATIONS,
        Permission.CREATE_DISTRIBUTOR,
        Permission.CREATE_DEALER,
        Permission.CREATE_END_USER,
        Permission.MANAGE_USERS,
        Permission.SUSPEND_USER,
        Permission.ACTIVATE_USER,
        Permission.VIEW_DEVICE,
        Permission.CONTROL_DEVICE,
        Permission.CONFIGURE_DEVICE,
        Permission.VIEW_ALERTS,
        Permission.MANAGE_ALERT_RULES,
        Permission.VIEW_RMA,
        Permission.MANAGE_RMA,
        Permission.VIEW_AUDIT_LOG,
    },
    UserRole.DISTRIBUTOR: {
        Permission.VIEW_SUBTREE_DASHBOARD,
        Permission.MANAGE_ORGANISATIONS,
        Permission.CREATE_DEALER,
        Permission.CREATE_END_USER,
        Permission.MANAGE_USERS,
        Permission.SUSPEND_USER,
        Permission.ACTIVATE_USER,
        Permission.VIEW_DEVICE,
        Permission.CONTROL_DEVICE,
        Permission.CONFIGURE_DEVICE,
        Permission.VIEW_ALERTS,
        Permission.VIEW_RMA,
    },
    UserRole.DEALER: {
        Permission.VIEW_SUBTREE_DASHBOARD,
        Permission.MANAGE_ORGANISATIONS,
        Permission.CREATE_DEALER,
        Permission.CREATE_END_USER,
        Permission.MANAGE_USERS,
        Permission.SUSPEND_USER,
        Permission.ACTIVATE_USER,
        Permission.VIEW_DEVICE,
        Permission.CONTROL_DEVICE,
        Permission.CONFIGURE_DEVICE,
        Permission.VIEW_ALERTS,
    },
    UserRole.SUPPORT_ENGINEER: {
        Permission.VIEW_SUBTREE_DASHBOARD,
        Permission.VIEW_DEVICE,
        Permission.CONTROL_DEVICE,
        Permission.CONFIGURE_DEVICE,
        Permission.VIEW_ALERTS,
        Permission.VIEW_RMA,
        Permission.MANAGE_RMA,
        Permission.VIEW_SYSTEM_HEALTH,
    },
    UserRole.END_USER: {
        Permission.VIEW_DEVICE,
        Permission.CONTROL_DEVICE,
        Permission.VIEW_ALERTS,
    },
}


def get_role_permissions(role: Union[UserRole, str]) -> Set[Permission]:
    """Retrieves all permissions for a given role."""
    canonical = normalize_role(role)
    return ROLE_PERMISSIONS.get(canonical, set())


def role_has_permission(role: Union[UserRole, str], permission: Union[Permission, str]) -> bool:
    """Checks whether the specified role has the requested permission."""
    perms = get_role_permissions(role)
    if isinstance(permission, str):
        try:
            perm_enum = Permission(permission)
        except ValueError:
            return False
    else:
        perm_enum = permission
    return perm_enum in perms
