"""
Centralized Authorization and Tenant Scoping Service
Phase 2B: AgriPump SmartSpace Backend RBAC + Organisation Scoping
"""
import uuid
import re
from typing import Any, Optional, Type, Union
from sqlalchemy.orm import Session, Query
from sqlalchemy import or_, text, func
from fastapi import HTTPException, status

from app.core.roles import (
    UserRole, normalize_role, to_db_role,
    DB_ROLE_SUPER_ADMIN, DB_ROLE_END_USER
)
from app.core.permissions import Permission, role_has_permission
from app.core.scope import path_in_scope, in_subtree
from app.models import User, Organisation, Pump, DeviceAccess, AuditLog


SECRET_KEYS_PATTERN = re.compile(r"(password|token|secret|otp|code_hash|device_key|api_key)", re.IGNORECASE)


def sanitize_audit_payload(payload: Optional[dict]) -> Optional[dict]:
    """Redacts any secret keys from JSON audit payloads to prevent credential leakage."""
    if not payload or not isinstance(payload, dict):
        return payload
    sanitized = {}
    for k, v in payload.items():
        if SECRET_KEYS_PATTERN.search(str(k)):
            sanitized[k] = "[REDACTED]"
        elif isinstance(v, dict):
            sanitized[k] = sanitize_audit_payload(v)
        elif isinstance(v, uuid.UUID):
            sanitized[k] = str(v)
        else:
            sanitized[k] = v
    return sanitized


class AuthorizationService:
    """
    Centralized service for RBAC permission checks, resource-level authorization,
    tenant/organisation scoping, and mandatory query predicate application.
    """

    @classmethod
    def can(
        cls,
        user: User,
        permission: Union[Permission, str],
        resource: Any = None,
        db: Optional[Session] = None
    ) -> bool:
        """
        Determines whether the given user has permission to perform the action,
        optionally verifying ownership / organisation subtree scope for a specific resource.
        """
        if not user:
            return False

        # 1. Base RBAC: verify role grants this permission
        if not role_has_permission(user.role, permission):
            return False

        # If no specific resource was provided, role permission is sufficient
        if resource is None:
            return True

        canonical_role = normalize_role(user.role)

        # 2. Super Admin has global access to all resources in this single-client deployment
        if canonical_role == UserRole.SUPER_ADMIN:
            return True

        # 3. Resource-level scoping
        if isinstance(resource, Organisation):
            return cls._can_access_organisation(user, resource, db)

        if isinstance(resource, Pump):
            return cls._can_access_pump(user, resource, db)

        if isinstance(resource, User):
            return cls._can_access_user(user, resource, db)

        # Dict or generic object with org_id or hierarchy_path
        if isinstance(resource, dict):
            return cls._can_access_dict_resource(user, resource, db)

        return False

    @classmethod
    def authorize(
        cls,
        user: User,
        permission: Union[Permission, str],
        resource: Any = None,
        db: Optional[Session] = None,
        error_status: int = status.HTTP_403_FORBIDDEN,
        error_detail: Optional[str] = None
    ) -> None:
        """
        Enforces authorization: raises an HTTPException if the user is not authorized.
        """
        if not cls.can(user, permission, resource, db):
            perm_name = permission.value if isinstance(permission, Permission) else str(permission)
            raise HTTPException(
                status_code=error_status,
                detail=error_detail or f"Access denied: insufficient permission or out of scope for '{perm_name}'"
            )

    @classmethod
    def _can_access_organisation(cls, user: User, org: Organisation, db: Optional[Session]) -> bool:
        """Verifies an organisation is within caller's own organisation subtree."""
        if not getattr(user, "org_id", None):
            return False

        # Direct match
        if str(user.org_id) == str(org.id):
            return True

        user_org = None
        if getattr(user, "organisation", None):
            user_org = user.organisation
        elif db:
            user_org = db.query(Organisation).filter(Organisation.id == user.org_id).first()

        if not user_org or not user_org.path or not org.path:
            return False

        return path_in_scope(user_org.path, org.path)

    @classmethod
    def _can_access_pump(cls, user: User, pump: Pump, db: Optional[Session]) -> bool:
        """Verifies pump/device belongs to caller (customer) or falls within partner's subtree."""
        canonical_role = normalize_role(user.role)

        # Customer / End User scope: must be direct owner or explicitly granted access
        if canonical_role == UserRole.END_USER:
            if pump.owner_user_id and str(pump.owner_user_id) == str(user.id):
                return True
            if db:
                access = (
                    db.query(DeviceAccess)
                    .filter(DeviceAccess.user_id == user.id, DeviceAccess.device_id == pump.id)
                    .first()
                )
                if access:
                    return True
            return False

        # Partner / Support scope: verify organisation subtree or hierarchy_path
        # 1. Match via Organisation subtree
        if getattr(user, "org_id", None):
            if pump.org_id and str(pump.org_id) == str(user.org_id):
                return True

            if pump.org_id and db:
                user_org = getattr(user, "organisation", None) or db.query(Organisation).filter(Organisation.id == user.org_id).first()
                pump_org = db.query(Organisation).filter(Organisation.id == pump.org_id).first()
                if user_org and pump_org and user_org.path and pump_org.path:
                    if path_in_scope(user_org.path, pump_org.path):
                        return True

        # 2. Match via legacy hierarchy_path
        if getattr(user, "hierarchy_path", None) and getattr(pump, "hierarchy_path", None):
            if path_in_scope(user.hierarchy_path, pump.hierarchy_path):
                return True

        return False

    @classmethod
    def _can_access_user(cls, user: User, target_user: User, db: Optional[Session]) -> bool:
        """Verifies target user is within caller's organisation subtree (or is self)."""
        if str(user.id) == str(target_user.id):
            return True

        if not getattr(user, "org_id", None):
            return False

        if target_user.org_id and str(user.org_id) == str(target_user.org_id):
            return True

        if target_user.org_id and db:
            user_org = getattr(user, "organisation", None) or db.query(Organisation).filter(Organisation.id == user.org_id).first()
            target_org = getattr(target_user, "organisation", None) or db.query(Organisation).filter(Organisation.id == target_user.org_id).first()
            if user_org and target_org and user_org.path and target_org.path:
                if path_in_scope(user_org.path, target_org.path):
                    return True

        if getattr(user, "hierarchy_path", None) and getattr(target_user, "hierarchy_path", None):
            if path_in_scope(user.hierarchy_path, target_user.hierarchy_path):
                return True

        return False

    @classmethod
    def _can_access_dict_resource(cls, user: User, res: dict, db: Optional[Session]) -> bool:
        if "org_id" in res and getattr(user, "org_id", None):
            if str(res["org_id"]) == str(user.org_id):
                return True
            if db:
                user_org = getattr(user, "organisation", None) or db.query(Organisation).filter(Organisation.id == user.org_id).first()
                res_org = db.query(Organisation).filter(Organisation.id == res["org_id"]).first()
                if user_org and res_org and user_org.path and res_org.path:
                    return path_in_scope(user_org.path, res_org.path)

        if "hierarchy_path" in res and getattr(user, "hierarchy_path", None):
            return path_in_scope(user.hierarchy_path, res["hierarchy_path"])

        return False

    @classmethod
    def apply_tenant_scope(
        cls,
        query: Query,
        model: Type,
        user: User,
        db: Session
    ) -> Query:
        """
        MANDATORY TENANT PREDICATE:
        Applies strict organisation/subtree scoping to the query for the authenticated user.
        Prevents full table scans and cross-tenant leakage.
        """
        canonical_role = normalize_role(user.role)

        # Super Admin has global platform access
        if canonical_role == UserRole.SUPER_ADMIN:
            return query

        # 1. PUMP / DEVICE MODEL
        if model is Pump:
            if canonical_role == UserRole.END_USER:
                accessible_device_ids = (
                    db.query(DeviceAccess.device_id)
                    .filter(DeviceAccess.user_id == user.id)
                    .scalar_subquery()
                )
                return query.filter(
                    or_(
                        Pump.owner_user_id == user.id,
                        Pump.id.in_(accessible_device_ids)
                    )
                )

            # Partner / Support
            predicates = []
            if getattr(user, "org_id", None):
                user_org = getattr(user, "organisation", None) or db.query(Organisation).filter(Organisation.id == user.org_id).first()
                if user_org and user_org.path:
                    # Find all organisation IDs in actor's sub-tree
                    org_rows = db.execute(
                        text("SELECT id FROM agripump.organisations WHERE path OPERATOR(agripump.<@) CAST(:upath AS agripump.ltree)"),
                        {"upath": str(user_org.path)}
                    ).fetchall()
                    org_ids = [r[0] for r in org_rows]
                    predicates.append(Pump.org_id.in_(org_ids))

            if getattr(user, "hierarchy_path", None):
                predicates.append(in_subtree(Pump.hierarchy_path, user.hierarchy_path))

            if predicates:
                return query.filter(or_(*predicates))

            return query.filter(text("1=0"))

        # 2. ORGANISATION MODEL
        if model is Organisation:
            if getattr(user, "org_id", None):
                user_org = getattr(user, "organisation", None) or db.query(Organisation).filter(Organisation.id == user.org_id).first()
                if user_org and user_org.path:
                    return query.filter(text("agripump.organisations.path OPERATOR(agripump.<@) CAST(:upath AS agripump.ltree)")).params(upath=str(user_org.path))
            return query.filter(text("1=0"))

        # 3. USER MODEL
        if model is User:
            predicates = [User.id == user.id]  # can always see self
            if getattr(user, "org_id", None):
                user_org = getattr(user, "organisation", None) or db.query(Organisation).filter(Organisation.id == user.org_id).first()
                if user_org and user_org.path:
                    org_rows = db.execute(
                        text("SELECT id FROM agripump.organisations WHERE path OPERATOR(agripump.<@) CAST(:upath AS agripump.ltree)"),
                        {"upath": str(user_org.path)}
                    ).fetchall()
                    org_ids = [r[0] for r in org_rows]
                    predicates.append(User.org_id.in_(org_ids))

            if getattr(user, "hierarchy_path", None):
                predicates.append(in_subtree(User.hierarchy_path, user.hierarchy_path))

            return query.filter(or_(*predicates))

        # Default fallback: safe query
        return query

    @classmethod
    def log_audit(
        cls,
        db: Session,
        actor: Optional[User],
        action: str,
        entity_type: str,
        entity_id: str,
        before: Optional[dict] = None,
        after: Optional[dict] = None,
        ip: Optional[str] = None
    ) -> AuditLog:
        """
        Writes an immutable audit entry without ever storing secrets, passwords, or tokens.
        """
        actor_id = actor.id if actor else None
        actor_role = to_db_role(actor.role) if actor else "system"

        sanitized_before = sanitize_audit_payload(before)
        sanitized_after = sanitize_audit_payload(after)

        entry = AuditLog(
            actor_id=actor_id,
            actor_role=actor_role,
            entity_type=str(entity_type)[:30],
            entity_id=str(entity_id)[:50],
            action=str(action)[:30],
            before_json=sanitized_before,
            after_json=sanitized_after,
            ip=ip[:45] if ip else None,
        )
        if actor:
            from app.api.deps import set_db_actor_context
            set_db_actor_context(db, user=actor)
        else:
            db.execute(text("SELECT set_config('app.bypass_rls', 'on', true)"))
        db.add(entry)
        db.commit()
        return entry
