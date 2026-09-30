"""
Organisation Invitation Service
Phase 2C: AgriPump SmartSpace Organisation Invitation & User Onboarding
"""
import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple, Union

from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import text, or_

from app.core.roles import (
    UserRole, OrgType, OrgStatus, UserStatus, AuditAction,
    ALLOWED_CHILD_USER_ROLES, MAX_DEALER_DEPTH,
    normalize_role, normalize_org_type, to_db_role
)
from app.core.permissions import Permission
from app.core.phone import normalize_phone, get_phone_variants
from app.core.scope import path_in_scope
from app.models import InviteToken, User, Organisation, AuditLog
from app.schemas.invitation import InvitationCreate, InvitationAcceptRequest
from app.services.authorization_service import AuthorizationService
from app.services.jwt_auth import hash_refresh_token, hash_secret
from app.services.phone_verification import (
    start_phone_verification, confirm_phone_verification, redeem_phone_verification
)
from app.api.auth import _issue_session
from app.api.deps import set_db_actor_context

logger = logging.getLogger("agripump.invitations")
INVITE_TTL = timedelta(days=7)
RESEND_COOLDOWN_SECONDS = 30


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _to_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _is_expired(dt: Optional[datetime]) -> bool:
    if dt is None:
        return False
    return _to_utc(dt) < _now_utc()


def _utc_iso(dt: Optional[datetime]) -> Optional[str]:
    if not dt:
        return None
    utc_dt = _to_utc(dt)
    return utc_dt.isoformat() if utc_dt else None


class InvitationService:

    @classmethod
    def create_invitation(
        cls,
        db: Session,
        actor: User,
        target_org_id: uuid.UUID,
        req: InvitationCreate
    ) -> Tuple[InviteToken, str]:
        """
        Creates an organisation invitation after validating actor permissions,
        hierarchy rules, dealer depth limit, and target organisation status.
        """
        # 1. Caller authenticated & active
        if actor.account_status != UserStatus.ACTIVE.value or actor.is_active is False:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Actor account is inactive or suspended.")

        actor_role = normalize_role(actor.role)

        # 2. Caller organisation active
        if actor_role != UserRole.SUPER_ADMIN and actor.org_id:
            caller_org = db.query(Organisation).filter(Organisation.id == actor.org_id).first()
            if not caller_org or caller_org.status in (OrgStatus.SUSPENDED.value, OrgStatus.DISABLED.value):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Your organisation is suspended or disabled. Invitations are blocked."
                )

        # 3. Caller permission check
        AuthorizationService.authorize(actor, Permission.MANAGE_ORGANISATIONS, db=db)

        # 4. Requested role validation
        target_role = normalize_role(req.role)
        allowed_roles = ALLOWED_CHILD_USER_ROLES.get(actor_role, set())
        if target_role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{actor_role.value}' is not authorized to invite role '{target_role.value}'."
            )

        # 5. Target organisation validation
        target_org = db.query(Organisation).filter(Organisation.id == target_org_id).first()
        if not target_org:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target organisation not found.")

        if target_org.status in (OrgStatus.SUSPENDED.value, OrgStatus.DISABLED.value):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot invite to a {target_org.status} organisation."
            )

        # Subtree boundary: non-superadmin must have target_org in their own subtree
        if actor_role != UserRole.SUPER_ADMIN:
            if not actor.org_id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Actor has no organisation assigned.")
            caller_org = db.query(Organisation).filter(Organisation.id == actor.org_id).first()
            if not caller_org or not path_in_scope(caller_org.path, target_org.path):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Target organisation is outside your permitted organisation scope."
                )

        # 6. Dealer depth limit validation (max 6 dealer levels)
        if target_role == UserRole.DEALER:
            dealer_ancestors = 0
            if target_org.path:
                labels = str(target_org.path).split(".")
                uuids = []
                for l in labels:
                    try:
                        uuids.append(uuid.UUID(l.replace("_", "-")))
                    except ValueError:
                        pass
                if uuids:
                    dealer_ancestors = db.query(Organisation).filter(
                        Organisation.id.in_(uuids),
                        Organisation.type == OrgType.DEALER.value
                    ).count()
            if dealer_ancestors >= MAX_DEALER_DEPTH:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Dealer depth cannot exceed {MAX_DEALER_DEPTH} levels: DEALER_DEPTH_LIMIT_REACHED"
                )

        # 7. Validate phone number and check existing accounts
        clean_phone = normalize_phone(req.phone)
        if not clean_phone:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid phone number format.")

        existing_user = db.query(User).filter(
            or_(User.phone == clean_phone, User.phone_number == clean_phone),
            User.account_status != UserStatus.DISABLED.value
        ).first()
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Phone number '{clean_phone}' is already registered to an active account."
            )

        # 8. Check for conflicting pending invitation
        now_utc = _now_utc()
        pending_inv = db.query(InviteToken).filter(
            InviteToken.phone == clean_phone,
            InviteToken.target_org_id == target_org.id,
            InviteToken.status == "PENDING",
            InviteToken.expires_at > now_utc
        ).first()
        if pending_inv:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A pending invitation for this phone number already exists in this organisation."
            )

        # 9. Generate token & record invitation
        raw_token = secrets.token_urlsafe(32)
        token_hash = hash_refresh_token(raw_token)
        expires_at = now_utc + INVITE_TTL

        db_role_str = to_db_role(target_role)
        invitation = InviteToken(
            token_hash=token_hash,
            role=db_role_str,
            target_role=target_role.value,
            phone=clean_phone,
            target_org_id=target_org.id,
            parent_user_id=actor.id,
            parent_hierarchy_path=actor.hierarchy_path or target_org.path,
            created_by=actor.id,
            status="PENDING",
            created_at=now_utc,
            expires_at=expires_at,
        )
        db.add(invitation)
        db.flush()

        # 10. Audit log (never log secret token)
        AuthorizationService.log_audit(
            db=db,
            actor=actor,
            action="INVITATION_CREATED",
            entity_type="invitation",
            entity_id=str(invitation.id),
            after={
                "phone": clean_phone,
                "role": target_role.value,
                "target_org_id": str(target_org.id),
                "expires_at": _utc_iso(expires_at),
            }
        )
        db.commit()
        db.refresh(invitation)
        return invitation, raw_token

    @classmethod
    def get_invitation_preview(cls, db: Session, token: str) -> Dict[str, Any]:
        """
        Public preview endpoint for an invitation link.
        Returns only safe metadata, never sensitive tokens or internal IDs.
        """
        token_hash = hash_refresh_token(token)
        inv = db.query(InviteToken).filter(InviteToken.token_hash == token_hash).first()
        if not inv or inv.status == "REVOKED":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation link is invalid or revoked.")

        now_utc = _now_utc()
        if _is_expired(inv.expires_at):
            if inv.status == "PENDING":
                inv.status = "EXPIRED"
                db.commit()
                AuthorizationService.log_audit(
                    db=db, actor=None, action="INVITATION_EXPIRED",
                    entity_type="invitation", entity_id=str(inv.id)
                )
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="INVITATION_EXPIRED")

        if inv.status == "ACCEPTED" or inv.used_at is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invitation has already been accepted.")

        target_org = db.query(Organisation).filter(Organisation.id == inv.target_org_id).first() if inv.target_org_id else None
        inviter = db.query(User).filter(User.id == inv.created_by).first() if inv.created_by else None
        inviter_org = None
        if inviter and inviter.org_id:
            inviter_org = db.query(Organisation).filter(Organisation.id == inviter.org_id).first()

        AuthorizationService.log_audit(
            db=db, actor=None, action="INVITATION_VIEWED",
            entity_type="invitation", entity_id=str(inv.id)
        )

        return {
            "role": inv.target_role or inv.role.upper(),
            "organisation_name": target_org.name if target_org else None,
            "inviter_organisation_name": inviter_org.name if inviter_org else (inviter.full_name if inviter else None),
            "expires_at": _utc_iso(inv.expires_at),
            "phone": inv.phone
        }

    @classmethod
    def accept_invitation(
        cls,
        db: Session,
        token: str,
        req: InvitationAcceptRequest
    ) -> Dict[str, Any]:
        """
        Accepts the invitation following WhatsApp OTP verification.
        Creates/activates user account strictly bound to the invitation's role and target organisation.
        """
        token_hash = hash_refresh_token(token)
        inv = db.query(InviteToken).filter(InviteToken.token_hash == token_hash).first()
        if not inv or inv.status == "REVOKED":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation link is invalid or revoked.")

        now_utc = _now_utc()
        if _is_expired(inv.expires_at):
            if inv.status == "PENDING":
                inv.status = "EXPIRED"
                db.commit()
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="INVITATION_EXPIRED")

        if inv.status == "ACCEPTED" or inv.used_at is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invitation has already been accepted.")

        # 1. Phone number match verification
        clean_phone = normalize_phone(req.phone)
        if inv.phone and clean_phone != inv.phone:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Provided phone number does not match the invited phone number."
            )

        # 2. WhatsApp OTP verification
        if req.otp:
            # Direct OTP confirmation
            verification_token = confirm_phone_verification(db, clean_phone, "registration", req.otp)
            redeem_phone_verification(db, clean_phone, "registration", verification_token)
        elif req.phone_verification_token:
            redeem_phone_verification(db, clean_phone, "registration", req.phone_verification_token)
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="WhatsApp OTP or phone verification token is required to accept invitation."
            )

        # 3. Check for existing active account
        existing = db.query(User).filter(
            or_(User.phone == clean_phone, User.phone_number == clean_phone),
            User.account_status != UserStatus.DISABLED.value
        ).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That phone number is already registered.")

        # 4. Resolve target organisation & role from invitation ONLY (never from client request)
        target_org = db.query(Organisation).filter(Organisation.id == inv.target_org_id).first() if inv.target_org_id else None
        target_role = normalize_role(inv.target_role or inv.role)
        db_role = to_db_role(target_role)

        parent_user = db.query(User).filter(User.id == inv.parent_user_id).first() if inv.parent_user_id else None
        parent_h_path = (parent_user.hierarchy_path if parent_user else None) or (target_org.path if target_org else "/SA")

        new_user_id = uuid.uuid4()
        user = User(
            id=new_user_id,
            full_name=req.full_name.strip() if req.full_name else f"User {clean_phone[-4:]}",
            phone=clean_phone,
            phone_number=clean_phone,
            password_hash=hash_secret(req.password) if req.password else None,
            role=db_role,
            org_id=target_org.id if target_org else None,
            hierarchy_path=f"{parent_h_path.rstrip('/')}/{new_user_id}",
            parent_user_id=parent_user.id if parent_user else None,
            account_status=UserStatus.ACTIVE.value,
            is_active=True,
            is_verified=True,
            session_version=1,
            locale="en"
        )
        db.add(user)
        db.flush()

        # 5. Mark invitation as ACCEPTED
        inv.status = "ACCEPTED"
        inv.accepted_at = now_utc
        inv.used_at = now_utc
        inv.used_by_user_id = user.id

        # 6. Row-level security context & Audit Logging
        set_db_actor_context(db, user=user)
        AuthorizationService.log_audit(
            db=db,
            actor=user,
            action="INVITATION_ACCEPTED",
            entity_type="invitation",
            entity_id=str(inv.id),
            after={"user_id": str(user.id), "role": user.role, "org_id": str(user.org_id)}
        )
        AuthorizationService.log_audit(
            db=db,
            actor=user,
            action="USER_CREATED",
            entity_type="user",
            entity_id=str(user.id),
            after={"phone": clean_phone, "role": user.role, "org_id": str(user.org_id)}
        )
        db.commit()
        db.refresh(user)

        # 7. Mint authenticated session
        session = _issue_session(db, user, None, "Invitation Acceptance")
        session["status"] = "AUTHENTICATED"
        session["user"] = {
            "id": str(user.id),
            "phone": user.phone,
            "role": user.role,
            "org_id": str(user.org_id) if user.org_id else None,
            "account_status": user.account_status
        }
        return session

    @classmethod
    def revoke_invitation(
        cls,
        db: Session,
        actor: User,
        invitation_id_or_token: str
    ) -> InviteToken:
        """Revokes an active invitation."""
        inv = None
        try:
            inv_uuid = uuid.UUID(invitation_id_or_token)
            inv = db.query(InviteToken).filter(InviteToken.id == inv_uuid).first()
        except ValueError:
            pass

        if not inv:
            token_hash = hash_refresh_token(invitation_id_or_token)
            inv = db.query(InviteToken).filter(InviteToken.token_hash == token_hash).first()

        if not inv:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found.")

        # Permission / scope check
        actor_role = normalize_role(actor.role)
        if actor_role != UserRole.SUPER_ADMIN and inv.created_by != actor.id:
            # Check if target_org is in actor's subtree
            if not actor.org_id or not inv.target_org_id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to revoke this invitation.")
            caller_org = db.query(Organisation).filter(Organisation.id == actor.org_id).first()
            target_org = db.query(Organisation).filter(Organisation.id == inv.target_org_id).first()
            if not caller_org or not target_org or not path_in_scope(caller_org.path, target_org.path):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invitation is outside your scope.")

        if inv.status == "ACCEPTED":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot revoke an already accepted invitation.")

        inv.status = "REVOKED"
        inv.used_at = _now_utc()
        AuthorizationService.log_audit(
            db=db,
            actor=actor,
            action="INVITATION_REVOKED",
            entity_type="invitation",
            entity_id=str(inv.id)
        )
        db.commit()
        db.refresh(inv)
        return inv

    @classmethod
    def resend_invitation(
        cls,
        db: Session,
        actor: User,
        invitation_id_or_token: str
    ) -> Dict[str, Any]:
        """Resends WhatsApp notification for a pending invitation with rate limiting."""
        inv = None
        try:
            inv_uuid = uuid.UUID(invitation_id_or_token)
            inv = db.query(InviteToken).filter(InviteToken.id == inv_uuid).first()
        except ValueError:
            pass

        if not inv:
            token_hash = hash_refresh_token(invitation_id_or_token)
            inv = db.query(InviteToken).filter(InviteToken.token_hash == token_hash).first()

        if not inv:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found.")

        if inv.status != "PENDING" or _is_expired(inv.expires_at):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot resend non-pending or expired invitation.")

        # Rate limit check on resends
        now_utc = _now_utc()
        created_utc = _to_utc(inv.created_at)
        if created_utc and (now_utc - created_utc).total_seconds() < RESEND_COOLDOWN_SECONDS:
            rem = int(RESEND_COOLDOWN_SECONDS - (now_utc - created_utc).total_seconds())
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {rem} seconds before resending invitation."
            )

        # Trigger WhatsApp OTP dispatch
        otp_res = start_phone_verification(db, inv.phone, "registration", channel="whatsapp")

        AuthorizationService.log_audit(
            db=db,
            actor=actor,
            action="INVITATION_RESENT",
            entity_type="invitation",
            entity_id=str(inv.id),
            after={"phone": inv.phone}
        )

        return {
            "message": "Invitation notification resent successfully via WhatsApp.",
            "phone": inv.phone,
            "status": "RESENT",
            "dev_otp": otp_res.get("dev_otp")
        }
