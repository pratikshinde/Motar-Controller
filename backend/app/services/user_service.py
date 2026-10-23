"""
User Service
Implements user creation, role assignment authorization, organization validation, and lifecycle controls.
Phase 2A: AgriPump SmartSpace Backend
"""
import uuid
from typing import Any, Dict, List, Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import text, or_

from app.core.errors import AppError
from app.core.phone import normalize_phone
from app.core.roles import (
    UserRole, OrgType, OrgStatus, UserStatus, AuditAction,
    ALLOWED_CHILD_USER_ROLES, COMPATIBLE_ORG_ROLES,
    normalize_role, normalize_org_type, to_db_role
)
from app.models.organisation import Organisation
from app.models.user import User
from app.models import AuditLog
from app.schemas.user import UserCreate, UserCreateInOrg, UserUpdate
from app.services.cache_service import cache_service
from app.services import brand_service
from app.services.jwt_auth import hash_secret


class UserService:

    @staticmethod
    def _audit(
        db: Session,
        actor: User,
        user_id: uuid.UUID,
        action: AuditAction | str,
        before: Optional[Dict[str, Any]] = None,
        after: Optional[Dict[str, Any]] = None
    ) -> None:
        action_name = action.value if isinstance(action, AuditAction) else str(action)
        actor_role = actor.role if actor else "SYSTEM"
        actor_id = actor.id if actor else None
        db.add(AuditLog(
            actor_id=actor_id,
            actor_role=actor_role,
            entity_type="user",
            entity_id=str(user_id),
            action=action_name,
            before_json=before,
            after_json=after,
        ))

    @staticmethod
    def validate_role_for_organisation(role: UserRole | str, org: Organisation) -> None:
        target_role = normalize_role(role) if isinstance(role, str) else role
        org_type = normalize_org_type(org.type)

        allowed = COMPATIBLE_ORG_ROLES.get(org_type, set())
        if target_role not in allowed:
            raise AppError(
                code="INCOMPATIBLE_ROLE_FOR_ORGANISATION",
                message_key="errors.incompatible_role_for_org",
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Role '{target_role.value}' cannot be assigned to users in organisation of type '{org_type.value}'."
            )

    @classmethod
    def create_user(
        cls,
        db: Session,
        actor: User,
        data: UserCreateInOrg,
        target_org_id: Optional[uuid.UUID] = None
    ) -> User:
        actor_role = normalize_role(actor.role)

        # 1. Determine requested role and validate assignment permission
        target_role = normalize_role(data.role)

        from app.services.authorization_service import AuthorizationService
        from app.core.permissions import Permission
        AuthorizationService.authorize(actor, Permission.MANAGE_USERS, db=db)
        if target_role == UserRole.END_USER:
            AuthorizationService.authorize(actor, Permission.CREATE_END_USER, db=db)

        # Never trust role SUPER_ADMIN from client unless caller is superadmin creating under root
        if target_role == UserRole.SUPER_ADMIN and actor_role != UserRole.SUPER_ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="FORBIDDEN: You are not authorized to create SUPER_ADMIN accounts."
            )

        allowed_roles = ALLOWED_CHILD_USER_ROLES.get(actor_role, set())
        if target_role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{actor_role.value}' is not permitted to create users with role '{target_role.value}'."
            )

        # 2. Determine and validate target organisation
        assigned_org_id = target_org_id
        if not assigned_org_id:
            if actor_role == UserRole.SUPER_ADMIN:
                root_org = db.query(Organisation).filter(Organisation.depth == 0).first()
                assigned_org_id = root_org.id if root_org else None
            else:
                assigned_org_id = actor.org_id

        if not assigned_org_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User must belong to an organisation."
            )

        org = db.query(Organisation).filter(Organisation.id == assigned_org_id).first()
        if not org:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target organisation not found.")

        # Check organisation status
        if org.status in (OrgStatus.SUSPENDED.value, OrgStatus.DISABLED.value):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot add user to {org.status} organisation."
            )

        # Scope validation: caller cannot add user to an org outside caller's subtree
        if actor_role != UserRole.SUPER_ADMIN:
            if not actor.org_id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Actor has no organisation.")
            caller_org = db.query(Organisation).filter(Organisation.id == actor.org_id).first()
            if not caller_org:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Actor organisation not found.")

            in_scope = db.execute(
                text("SELECT 1 FROM agripump.organisations WHERE id = :id AND path <@ :caller_path"),
                {"id": org.id, "caller_path": str(caller_org.path)}
            ).first()
            if not in_scope:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot assign user to an organisation outside your hierarchy."
                )

        # 3. Validate role compatibility with organisation
        cls.validate_role_for_organisation(target_role, org)

        # 4. Normalize & validate phone uniqueness for active users
        raw_phone = data.phone or data.phone_number
        phone = normalize_phone(raw_phone) if raw_phone else None
        if not phone:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Valid phone number is required.")

        existing_user = db.query(User).filter(
            or_(User.phone == phone, User.phone_number == phone),
            User.account_status != UserStatus.DISABLED.value
        ).first()
        if existing_user:
            raise AppError(
                code="PHONE_ALREADY_EXISTS",
                message_key="errors.phone_already_exists",
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A user with phone number '{phone}' already exists."
            )

        # 5. Create user
        new_id = uuid.uuid4()
        user_name = (data.name or data.full_name or "").strip()
        db_role = to_db_role(target_role)

        # Hierarchy path mirrors organisation path or user hierarchy
        user_path = f"{org.path}/{new_id}"
        dealer_depth = 0
        if normalize_org_type(org.type) == OrgType.DEALER:
            res = db.execute(
                text("SELECT count(*) FROM agripump.organisations WHERE path @> :path AND UPPER(type) = 'DEALER'"),
                {"path": str(org.path)}
            ).scalar()
            dealer_depth = min(int(res or 1), 6)

        user = User(
            id=new_id,
            full_name=user_name,
            phone=phone,
            phone_number=phone,
            email=data.email.lower().strip() if data.email else None,
            role=db_role,
            org_id=org.id,
            hierarchy_path=user_path,
            parent_user_id=actor.id if actor else None,
            brand_id=brand_service.brand_id_for_new_account(db, db_role, parent=None, creator=actor, org=org),
            dealer_depth=dealer_depth,
            account_status=UserStatus.ACTIVE.value,
            locale=data.locale or "en",
            is_active=True,
            password_hash=hash_secret(data.password) if data.password else None,
        )
        db.add(user)
        db.flush()

        # Audit event
        cls._audit(
            db, actor, user.id, AuditAction.USER_CREATED,
            after={
                "name": user.full_name,
                "phone": user.phone,
                "role": target_role.value,
                "org_id": str(org.id),
                "org_type": org.type
            }
        )
        db.commit()
        db.refresh(user)
        return user

    @classmethod
    def get_user(cls, db: Session, actor: User, user_id: uuid.UUID) -> User:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

        actor_role = normalize_role(actor.role)
        if actor_role != UserRole.SUPER_ADMIN and user.id != actor.id:
            # Check if user belongs to an org in actor's subtree
            if actor.org_id and user.org_id:
                caller_org = db.query(Organisation).filter(Organisation.id == actor.org_id).first()
                if caller_org:
                    in_scope = db.execute(
                        text("SELECT 1 FROM agripump.organisations WHERE id = :id AND path <@ :caller_path"),
                        {"id": user.org_id, "caller_path": str(caller_org.path)}
                    ).first()
                    if in_scope:
                        return user
            # Fallback to hierarchy_path scope
            from app.core.scope import path_in_scope
            if actor.hierarchy_path and user.hierarchy_path and path_in_scope(actor.hierarchy_path, user.hierarchy_path):
                return user
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

        return user

    @classmethod
    def update_user(
        cls,
        db: Session,
        actor: User,
        user_id: uuid.UUID,
        data: UserUpdate
    ) -> User:
        user = cls.get_user(db, actor, user_id)
        actor_role = normalize_role(actor.role)
        is_self = user.id == actor.id

        changes = data.model_dump(exclude_unset=True)
        if not changes:
            return user

        # Self-update restrictions: users cannot arbitrarily change their own org_id, role, or status
        if is_self and ("org_id" in changes or "role" in changes or "status" in changes or "account_status" in changes or "contract_notes" in changes or "device_quota" in changes):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot change your own contract terms or status."
            )

        if "account_status" in changes and changes["account_status"] not in ("ACTIVE", "SUSPENDED"):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="account_status must be ACTIVE or SUSPENDED")


        # Organisation move restriction
        if "org_id" in changes and changes["org_id"] is not None:
            new_org_id = changes["org_id"]
            if str(new_org_id) != str(user.org_id):
                # Only superadmin or authorized manager can move users between organisations
                if actor_role != UserRole.SUPER_ADMIN:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="You are not authorized to change this user's organisation."
                    )
                new_org = db.query(Organisation).filter(Organisation.id == new_org_id).first()
                if not new_org:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="New organisation not found.")
                cls.validate_role_for_organisation(user.role, new_org)
                user.org_id = new_org.id

        # Role change
        if "role" in changes and changes["role"] is not None:
            new_role = normalize_role(changes["role"])
            if new_role.value != user.role:
                cls.assign_role(db, actor, user_id, new_role.value)

        before = {
            "name": user.full_name,
            "phone": user.phone,
            "status": user.status,
            "org_id": str(user.org_id) if user.org_id else None
        }

        if "name" in changes and changes["name"]:
            user.full_name = changes["name"].strip()
        elif "full_name" in changes and changes["full_name"]:
            user.full_name = changes["full_name"].strip()

        if "phone" in changes and changes["phone"]:
            p = normalize_phone(changes["phone"])
            if p and p != user.phone:
                # Check uniqueness
                dup = db.query(User).filter(
                    or_(User.phone == p, User.phone_number == p),
                    User.id != user.id,
                    User.account_status != UserStatus.DISABLED.value
                ).first()
                if dup:
                    raise AppError(
                        code="PHONE_ALREADY_EXISTS",
                        message_key="errors.phone_already_exists",
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f"Phone number '{p}' is already in use."
                    )
                user.phone = p
                user.phone_number = p

        if "email" in changes:
            user.email = changes["email"].lower().strip() if changes["email"] else None

        if "contract_notes" in changes:
            user.contract_notes = changes["contract_notes"]

        if "device_quota" in changes:
            user.device_quota = changes["device_quota"]

        if "locale" in changes and changes["locale"]:
            user.locale = changes["locale"]

        status_val = changes.get("status") or changes.get("account_status")
        if status_val and not is_self:
            user.account_status = status_val
            user.is_active = (status_val == UserStatus.ACTIVE.value)
            if status_val == UserStatus.SUSPENDED.value:
                cache_service.increment_user_session_version(str(user.id))
                user.session_version = (user.session_version or 1) + 1

        cls._audit(db, actor, user.id, AuditAction.USER_UPDATED, before=before, after=changes)
        db.commit()
        db.refresh(user)
        return user

    @classmethod
    def suspend_user(
        cls,
        db: Session,
        actor: User,
        user_id: uuid.UUID,
        reason: Optional[str] = None
    ) -> User:
        user = cls.get_user(db, actor, user_id)
        if user.id == actor.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot suspend your own account.")

        from app.services.authorization_service import AuthorizationService
        from app.core.permissions import Permission
        AuthorizationService.authorize(actor, Permission.SUSPEND_USER, resource=user, db=db)

        if user.role == to_db_role(UserRole.SUPER_ADMIN):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot suspend SUPER_ADMIN accounts.")

        before = {"status": user.account_status}
        user.account_status = UserStatus.SUSPENDED.value
        user.is_active = False

        cache_service.increment_user_session_version(str(user.id))
        user.session_version = (user.session_version or 1) + 1

        cls._audit(
            db, actor, user.id, AuditAction.USER_SUSPENDED,
            before=before, after={"status": user.account_status, "reason": reason}
        )
        db.commit()
        db.refresh(user)
        return user

    @classmethod
    def activate_user(
        cls,
        db: Session,
        actor: User,
        user_id: uuid.UUID
    ) -> User:
        user = cls.get_user(db, actor, user_id)
        if user.id == actor.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot activate your own account.")

        from app.services.authorization_service import AuthorizationService
        from app.core.permissions import Permission
        AuthorizationService.authorize(actor, Permission.ACTIVATE_USER, resource=user, db=db)

        # Ensure user's organisation is not suspended
        if user.org_id:
            org = db.query(Organisation).filter(Organisation.id == user.org_id).first()
            if org and org.status in (OrgStatus.SUSPENDED.value, OrgStatus.DISABLED.value):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Cannot activate user: organisation is {org.status}."
                )

        before = {"status": user.account_status}
        user.account_status = UserStatus.ACTIVE.value
        user.is_active = True

        cls._audit(db, actor, user.id, AuditAction.USER_ACTIVATED, before=before, after={"status": user.account_status})
        db.commit()
        db.refresh(user)
        return user

    @classmethod
    def assign_role(
        cls,
        db: Session,
        actor: User,
        user_id: uuid.UUID,
        new_role_str: str
    ) -> User:
        user = cls.get_user(db, actor, user_id)
        actor_role = normalize_role(actor.role)
        target_role = normalize_role(new_role_str)

        if user.id == actor.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot change your own role.")

        # Super Admin role cannot be assigned by non-superadmins
        if target_role == UserRole.SUPER_ADMIN and actor_role != UserRole.SUPER_ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="FORBIDDEN: You cannot assign SUPER_ADMIN role."
            )

        allowed_roles = ALLOWED_CHILD_USER_ROLES.get(actor_role, set())
        if target_role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{actor_role.value}' cannot assign role '{target_role.value}'."
            )

        # Validate role compatibility with user's current organisation
        if user.org_id:
            org = db.query(Organisation).filter(Organisation.id == user.org_id).first()
            if org:
                cls.validate_role_for_organisation(target_role, org)

        before_role = user.role
        user.role = to_db_role(target_role)

        cls._audit(
            db, actor, user.id, AuditAction.USER_ROLE_CHANGED,
            before={"role": before_role},
            after={"role": user.role, "display_role": target_role.value}
        )
        db.commit()
        db.refresh(user)
        return user

    @classmethod
    def get_users_by_organisation(
        cls,
        db: Session,
        actor: User,
        org_id: uuid.UUID
    ) -> List[User]:
        # Validate caller can view this organisation
        from app.services.organisation_service import OrganisationService
        OrganisationService.get_organisation(db, actor, org_id)

        return (
            db.query(User)
            .filter(User.org_id == org_id)
            .order_by(User.created_at.desc())
            .all()
        )
