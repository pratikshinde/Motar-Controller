"""
Organisation Service
Implements hierarchy validation, dealer depth guards, scope filtering, and lifecycle management.
Phase 2A: AgriPump SmartSpace Backend
"""
import uuid
from typing import Any, Dict, List, Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.errors import AppError
from app.core.roles import (
    UserRole, OrgType, OrgStatus, AuditAction,
    ALLOWED_CHILD_ORG_TYPES, ALLOWED_ROLE_CREATE_ORG, MAX_DEALER_DEPTH,
    normalize_role, normalize_org_type, normalize_org_status
)
from app.models.organisation import Organisation
from app.models.user import User
from app.models import AuditLog
from app.schemas.organisation import OrganisationCreate, OrganisationUpdate, OrganisationTreeNode
from app.services.cache_service import cache_service


class OrganisationService:

    @staticmethod
    def _audit(
        db: Session,
        actor: User,
        org_id: uuid.UUID,
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
            entity_type="organisation",
            entity_id=str(org_id),
            action=action_name,
            before_json=before,
            after_json=after,
        ))

    @staticmethod
    def get_root_organisation(db: Session) -> Optional[Organisation]:
        return db.query(Organisation).filter(Organisation.depth == 0).first()

    @staticmethod
    def validate_parent_child_relationship(parent_type: OrgType | str, child_type: OrgType | str) -> None:
        p_type = normalize_org_type(parent_type)
        c_type = normalize_org_type(child_type)

        allowed = ALLOWED_CHILD_ORG_TYPES.get(p_type, set())
        if c_type not in allowed:
            raise AppError(
                code="INVALID_PARENT_CHILD_RELATIONSHIP",
                message_key="errors.invalid_hierarchy_relationship",
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Organisation type '{c_type.value}' cannot be created under parent of type '{p_type.value}'."
            )

    @staticmethod
    def validate_dealer_depth(db: Session, parent_org: Organisation) -> int:
        """
        Validates dealer hierarchy depth.
        Maximum chain: Distributor -> Dealer L1 -> L2 -> L3 -> L4 -> L5 -> L6.
        Attempting to create another dealer below L6 must fail with DEALER_DEPTH_LIMIT_REACHED.
        Returns the dealer level of the new child.
        """
        parent_type = normalize_org_type(parent_org.type)

        if parent_type == OrgType.DISTRIBUTOR:
            return 1

        if parent_type == OrgType.DEALER:
            # Count dealer ancestors including the parent itself
            result = db.execute(
                text("SELECT count(*) FROM agripump.organisations WHERE path @> :path AND UPPER(type) = 'DEALER'"),
                {"path": str(parent_org.path)}
            ).scalar()
            current_dealer_depth = int(result or 0)
            if current_dealer_depth >= MAX_DEALER_DEPTH:
                raise AppError(
                    code="DEALER_DEPTH_LIMIT_REACHED",
                    message_key="errors.dealer_depth_limit_reached",
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Dealer hierarchy depth limit reached. Maximum allowed dealer depth is {MAX_DEALER_DEPTH} (DEALER_DEPTH_LIMIT_REACHED)."
                )
            return current_dealer_depth + 1

        return 1

    @classmethod
    def create_organisation(
        cls,
        db: Session,
        actor: User,
        data: OrganisationCreate
    ) -> Organisation:
        """
        1. Authenticate caller (done by deps).
        2. Determine caller role.
        3. Determine caller organisation.
        4. Validate requested child organisation type.
        5. Validate caller has permission.
        6. Validate parent organisation.
        7. Validate organisation depth.
        8. Create organisation.
        9. Audit the action.
        """
        actor_role = normalize_role(actor.role)

        # Non-administrative operational roles cannot create organisations
        if actor_role in (UserRole.SUPPORT_ENGINEER, UserRole.END_USER):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your account role is not authorized to create organisations."
            )

        # Check caller organisation status: suspended orgs cannot manage
        if actor_role != UserRole.SUPER_ADMIN and actor.org_id:
            caller_org = db.query(Organisation).filter(Organisation.id == actor.org_id).first()
            if caller_org and caller_org.status in (OrgStatus.SUSPENDED.value, OrgStatus.DISABLED.value):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Your organisation is {caller_org.status}. Management actions are blocked."
                )

        # 4. Validate requested child organisation type
        try:
            target_type = normalize_org_type(data.type)
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))

        # 5. Validate caller role permission for creating child org type
        from app.services.authorization_service import AuthorizationService
        from app.core.permissions import Permission
        AuthorizationService.authorize(actor, Permission.MANAGE_ORGANISATIONS, db=db)
        if target_type == OrgType.MANUFACTURER:
            AuthorizationService.authorize(actor, Permission.CREATE_MANUFACTURER, db=db)
        elif target_type == OrgType.DISTRIBUTOR:
            AuthorizationService.authorize(actor, Permission.CREATE_DISTRIBUTOR, db=db)
        elif target_type == OrgType.DEALER:
            AuthorizationService.authorize(actor, Permission.CREATE_DEALER, db=db)

        allowed_types = ALLOWED_ROLE_CREATE_ORG.get(actor_role, set())
        if target_type not in allowed_types:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{actor_role.value}' cannot create organisation of type '{target_type.value}'."
            )

        # 6. Validate parent organisation
        parent_org: Optional[Organisation] = None
        if data.parent_id:
            parent_org = db.query(Organisation).filter(Organisation.id == data.parent_id).first()
            if not parent_org:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent organisation not found.")
        else:
            # Default parent: if caller is superadmin, root org; otherwise caller's own org
            if actor_role == UserRole.SUPER_ADMIN:
                parent_org = cls.get_root_organisation(db)
            elif actor.org_id:
                parent_org = db.query(Organisation).filter(Organisation.id == actor.org_id).first()

        if not parent_org:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Could not determine parent organisation.")

        # Caller scope check: non-superadmin must be within their own subtree
        if actor_role != UserRole.SUPER_ADMIN:
            if not actor.org_id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Actor has no organisation assigned.")
            caller_org = db.query(Organisation).filter(Organisation.id == actor.org_id).first()
            if not caller_org:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Actor organisation not found.")
            # Verify parent is caller_org or descendant of caller_org
            is_descendant = db.execute(
                text("SELECT 1 FROM agripump.organisations WHERE id = :pid AND path <@ :caller_path"),
                {"pid": parent_org.id, "caller_path": str(caller_org.path)}
            ).first()
            if not is_descendant:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Parent organisation is outside your scope.")

        # Parent must be ACTIVE
        if parent_org.status in (OrgStatus.SUSPENDED.value, OrgStatus.DISABLED.value):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot create child organisation: parent organisation is {parent_org.status}."
            )

        # Validate parent-child type hierarchy rule
        cls.validate_parent_child_relationship(parent_org.type, target_type)

        # 7. Validate organisation depth
        if target_type == OrgType.DEALER:
            cls.validate_dealer_depth(db, parent_org)

        # 8. Create organisation
        new_id = uuid.uuid4()
        v_label = str(new_id).replace("-", "_")
        path_str = f"{parent_org.path}.{v_label}"

        new_org = Organisation(
            id=new_id,
            parent_id=parent_org.id,
            type=target_type.value,
            name=data.name.strip(),
            path=path_str,
            depth=parent_org.depth + 1,
            status=OrgStatus.ACTIVE.value,
            branding_id=data.branding_id,
        )
        db.add(new_org)
        db.flush()

        # 9. Audit the action
        cls._audit(
            db, actor, new_org.id, AuditAction.ORGANISATION_CREATED,
            after={
                "name": new_org.name,
                "type": new_org.type,
                "parent_id": str(parent_org.id),
                "depth": new_org.depth
            }
        )
        db.commit()
        db.refresh(new_org)
        return new_org

    @classmethod
    def get_organisation(cls, db: Session, actor: User, org_id: uuid.UUID) -> Organisation:
        org = db.query(Organisation).filter(Organisation.id == org_id).first()
        if not org:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organisation not found.")

        actor_role = normalize_role(actor.role)
        if actor_role != UserRole.SUPER_ADMIN:
            if not actor.org_id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Actor has no organisation assigned.")
            caller_org = db.query(Organisation).filter(Organisation.id == actor.org_id).first()
            if not caller_org:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Actor organisation not found.")
            # Check if org is within caller's subtree
            in_scope = db.execute(
                text("SELECT 1 FROM agripump.organisations WHERE id = :id AND path <@ :caller_path"),
                {"id": org.id, "caller_path": str(caller_org.path)}
            ).first()
            if not in_scope:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organisation not found.")

        return org

    @classmethod
    def update_organisation(
        cls,
        db: Session,
        actor: User,
        org_id: uuid.UUID,
        data: OrganisationUpdate
    ) -> Organisation:
        org = cls.get_organisation(db, actor, org_id)
        actor_role = normalize_role(actor.role)

        # Root organisation name cannot be wiped
        if org.depth == 0 and actor_role != UserRole.SUPER_ADMIN:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot modify root organisation.")

        changes = data.model_dump(exclude_unset=True)
        if not changes:
            return org

        before = {
            "name": org.name,
            "status": org.status,
            "branding_id": str(org.branding_id) if org.branding_id else None
        }

        if "name" in changes and changes["name"]:
            org.name = changes["name"].strip()
        if "branding_id" in changes:
            org.branding_id = changes["branding_id"]
        if "status" in changes and changes["status"]:
            new_status = normalize_org_status(changes["status"]).value
            # Only SUPER_ADMIN or parent org manager can change status
            if actor_role != UserRole.SUPER_ADMIN and actor.org_id == org.id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot alter your own organisation status.")
            org.status = new_status

        cls._audit(db, actor, org.id, AuditAction.ORGANISATION_UPDATED, before=before, after=changes)
        db.commit()
        db.refresh(org)
        return org

    @classmethod
    def suspend_organisation(
        cls,
        db: Session,
        actor: User,
        org_id: uuid.UUID,
        reason: Optional[str] = None
    ) -> Organisation:
        org = cls.get_organisation(db, actor, org_id)
        actor_role = normalize_role(actor.role)

        if org.depth == 0:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Root organisation cannot be suspended.")

        if actor_role != UserRole.SUPER_ADMIN and actor.org_id == org.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot suspend your own organisation.")

        before = {"status": org.status}
        org.status = OrgStatus.SUSPENDED.value

        # Increment session version for all users in this organisation and descendants
        affected_users = db.execute(
            text("""
                SELECT u.id FROM agripump.users u
                JOIN agripump.organisations o ON u.org_id = o.id
                WHERE o.path <@ :path
            """),
            {"path": str(org.path)}
        ).fetchall()

        for (u_id,) in affected_users:
            cache_service.increment_user_session_version(str(u_id))

        db.execute(
            text("""
                UPDATE agripump.users
                SET session_version = session_version + 1
                WHERE org_id IN (
                    SELECT id FROM agripump.organisations WHERE path <@ :path
                )
            """),
            {"path": str(org.path)}
        )

        cls._audit(
            db, actor, org.id, AuditAction.ORGANISATION_SUSPENDED,
            before=before, after={"status": org.status, "reason": reason}
        )
        db.commit()
        db.refresh(org)
        return org

    @classmethod
    def activate_organisation(
        cls,
        db: Session,
        actor: User,
        org_id: uuid.UUID
    ) -> Organisation:
        org = cls.get_organisation(db, actor, org_id)
        actor_role = normalize_role(actor.role)

        if actor_role != UserRole.SUPER_ADMIN and actor.org_id == org.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot activate your own organisation.")

        # Ensure parent organisation is not suspended or disabled
        if org.parent_id:
            parent = db.query(Organisation).filter(Organisation.id == org.parent_id).first()
            if parent and parent.status in (OrgStatus.SUSPENDED.value, OrgStatus.DISABLED.value):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Cannot activate organisation: parent organisation is {parent.status}."
                )

        before = {"status": org.status}
        org.status = OrgStatus.ACTIVE.value

        cls._audit(db, actor, org.id, AuditAction.ORGANISATION_ACTIVATED, before=before, after={"status": org.status})
        db.commit()
        db.refresh(org)
        return org

    @classmethod
    def delete_organisation(
        cls,
        db: Session,
        actor: User,
        org_id: uuid.UUID
    ) -> None:
        org = cls.get_organisation(db, actor, org_id)
        if org.depth == 0:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Root organisation cannot be deleted.")

        # Check if org has children
        has_children = db.query(Organisation.id).filter(Organisation.parent_id == org.id).first()
        if has_children:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Organisation has child organisations. Remove or move them first."
            )

        # Check if org has users
        has_users = db.query(User.id).filter(User.org_id == org.id).first()
        if has_users:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Organisation has associated user accounts. Reassign or remove them first."
            )

        cls._audit(db, actor, org.id, AuditAction.ORGANISATION_DELETED, before={"name": org.name, "type": org.type})
        db.delete(org)
        db.commit()

    @classmethod
    def get_children(cls, db: Session, actor: User, org_id: uuid.UUID) -> List[Organisation]:
        # Validate caller can view target org
        cls.get_organisation(db, actor, org_id)
        return db.query(Organisation).filter(Organisation.parent_id == org_id).order_by(Organisation.name).all()

    @classmethod
    def get_ancestors(cls, db: Session, actor: User, org_id: uuid.UUID) -> List[Organisation]:
        org = cls.get_organisation(db, actor, org_id)
        return (
            db.query(Organisation)
            .filter(text("path @> :p")).params(p=str(org.path))
            .order_by(Organisation.depth.asc())
            .all()
        )

    @classmethod
    def get_descendants(cls, db: Session, actor: User, org_id: uuid.UUID) -> List[Organisation]:
        org = cls.get_organisation(db, actor, org_id)
        return (
            db.query(Organisation)
            .filter(text("path <@ :p AND id != :oid")).params(p=str(org.path), oid=org.id)
            .order_by(Organisation.depth.asc(), Organisation.name.asc())
            .all()
        )

    @classmethod
    def get_subtree(cls, db: Session, actor: User, org_id: uuid.UUID) -> Dict[str, Any]:
        root_org = cls.get_organisation(db, actor, org_id)
        nodes = (
            db.query(Organisation)
            .filter(text("path <@ :p")).params(p=str(root_org.path))
            .order_by(Organisation.depth.asc())
            .all()
        )

        def to_node_dict(o: Organisation) -> Dict[str, Any]:
            return {
                "id": str(o.id),
                "parent_id": str(o.parent_id) if o.parent_id else None,
                "type": o.type,
                "name": o.name,
                "status": o.status,
                "depth": o.depth,
                "path": str(o.path) if o.path else None,
                "branding_id": str(o.branding_id) if o.branding_id else None,
                "children": []
            }

        node_map = {str(o.id): to_node_dict(o) for o in nodes}
        root_dict = node_map.get(str(root_org.id))

        for o in nodes:
            if o.id != root_org.id and o.parent_id:
                p_dict = node_map.get(str(o.parent_id))
                if p_dict:
                    p_dict["children"].append(node_map[str(o.id)])

        return {"subtree": root_dict, "nodes_count": len(nodes)}

    @classmethod
    def list_organisations(cls, db: Session, actor: User) -> List[Organisation]:
        actor_role = normalize_role(actor.role)
        if actor_role == UserRole.SUPER_ADMIN:
            return db.query(Organisation).order_by(Organisation.depth.asc(), Organisation.name.asc()).all()

        if not actor.org_id:
            return []

        caller_org = db.query(Organisation).filter(Organisation.id == actor.org_id).first()
        if not caller_org:
            return []

        return (
            db.query(Organisation)
            .filter(text("path <@ :p")).params(p=str(caller_org.path))
            .order_by(Organisation.depth.asc(), Organisation.name.asc())
            .all()
        )
