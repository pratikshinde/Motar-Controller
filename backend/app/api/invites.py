"""Onboarding links for new accounts (FR-WEB-035): a partner creates a link, the invited person registers with it.

The link is a random secret shown once. Only its hash is stored, it works once, and it expires after seven days.
Redeeming it needs no session (the person has no account yet), so what protects it is the size of the secret, the
single-use claim below, and answering every kind of bad link with the same message.

Not to be confused with `POST /auth/invites`, which invites an existing farmer (by phone number) to one pump.
"""
import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.auth import _issue_session, get_phone_variants
from app.core.phone import normalize_phone
from app.api.deps import set_db_actor_context, get_current_user
from app.api.users import (
    ASSIGNABLE_ROLES, MAX_DEALER_DEPTH, MIN_PARTNER_PASSWORD, PARTNER_ROLES, _get_in_scope, partner_only,
)
from app.database import get_db
from app.models import AuditLog, InviteToken
from app.models.user import User
from app.schemas import PartnerInviteCreate, PartnerInviteRedeem
from app.services.jwt_auth import hash_refresh_token, hash_secret
from app.services.phone_verification import redeem_phone_verification

logger = logging.getLogger("agripump.invites")
router = APIRouter(tags=["Invites"])

INVITE_TTL = timedelta(days=7)
PHONE_PATTERN = re.compile(r"^\+?\d{10,15}$")
BAD_LINK = "This invite link is not valid. It may have expired or already been used; ask for a new one."


def _dealer_depth(role: str, parent: User) -> int:
    if role != "dealer":
        return 0
    return (parent.dealer_depth or 0) + 1 if parent.role == "dealer" else 1


def _utc_iso(value: datetime) -> str:
    """The database keeps naive UTC; say so, or a browser reads the time as its own local time."""
    return value.replace(tzinfo=timezone.utc).isoformat()


@router.post("")
def create_invite_link(req: PartnerInviteCreate, current_user: User = Depends(partner_only), db: Session = Depends(get_db)):
    role = (req.role or "").strip().lower()
    if role not in ASSIGNABLE_ROLES.get(current_user.role, []):
        raise HTTPException(status_code=403, detail=f"A {current_user.role} account cannot invite a {role or 'blank'} account.")

    parent = current_user
    if req.parent_user_id:
        try:
            parent = _get_in_scope(db, current_user, uuid.UUID(req.parent_user_id))
        except ValueError:
            raise HTTPException(status_code=422, detail="parent_user_id is not a valid id")
    if parent.role not in PARTNER_ROLES or role not in ASSIGNABLE_ROLES.get(parent.role, []):
        raise HTTPException(status_code=422, detail=f"A {role} account cannot be placed under a {parent.role} account.")
    if _dealer_depth(role, parent) > MAX_DEALER_DEPTH:
        raise HTTPException(status_code=422, detail=f"Dealer sub-levels are limited to {MAX_DEALER_DEPTH}.")

    token = secrets.token_urlsafe(32)
    invite = InviteToken(
        token_hash=hash_refresh_token(token),
        role=role,
        parent_user_id=parent.id,
        parent_hierarchy_path=parent.hierarchy_path,
        created_by=current_user.id,
        expires_at=datetime.utcnow() + INVITE_TTL,
    )
    db.add(invite)
    db.flush()
    db.add(AuditLog(
        actor_id=current_user.id, actor_role=current_user.role, entity_type="invite", entity_id=str(invite.id),
        action="INVITE_CREATED", after_json={"role": role, "parent": str(parent.id)},
    ))
    db.commit()
    return {"message": "Invite link created", "token": token, "role": role, "expires_at": _utc_iso(invite.expires_at)}


def _account_usable(user: Optional[User]) -> bool:
    return user is not None and user.account_status == "ACTIVE" and user.is_active is not False


@router.get("/{token}")
def preview_invite_link(token: str, db: Session = Depends(get_db)):
    """What the sign-up page needs to know before it asks for anything: who invited you, as what, and until when."""
    from app.services.invitation_service import InvitationService
    return InvitationService.get_invitation_preview(db, token)


@router.post("/{token}/redeem")
def redeem_invite_link(token: str, req: PartnerInviteRedeem, db: Session = Depends(get_db)):
    full_name = req.full_name.strip()
    phone = normalize_phone(req.phone_number)
    if not full_name:
        raise HTTPException(status_code=422, detail="Your name is required.")
    if not PHONE_PATTERN.match(phone):
        raise HTTPException(status_code=422, detail="Enter a valid mobile number (10 to 15 digits).")

    # Claim the link before anything else. One UPDATE decides who gets it, so two people opening the same link at
    # the same moment cannot both register; a failure further down rolls the claim back with everything else.
    claimed = db.execute(
        update(InviteToken)
        .where(
            InviteToken.token_hash == hash_refresh_token(token),
            InviteToken.used_at.is_(None),
            InviteToken.expires_at > datetime.utcnow(),
        )
        .values(used_at=datetime.utcnow())
        .returning(
            InviteToken.id, InviteToken.role, InviteToken.parent_user_id,
            InviteToken.parent_hierarchy_path, InviteToken.created_by,
        )
    ).first()
    if not claimed:
        raise HTTPException(status_code=404, detail=BAD_LINK)
    invite_id, role, parent_id, parent_path, created_by = claimed

    # A link outlives neither the person who made it being suspended or removed, nor the account it hangs under.
    inviter = db.query(User).filter(User.id == created_by).first() if created_by else None
    parent = db.query(User).filter(User.id == parent_id).first()
    if not _account_usable(inviter) or not _account_usable(parent):
        raise HTTPException(status_code=404, detail=BAD_LINK)

    if role != "customer" and (not req.password or len(req.password) < MIN_PARTNER_PASSWORD):
        raise HTTPException(status_code=422, detail=f"A password of at least {MIN_PARTNER_PASSWORD} characters is required.")
    if db.query(User.id).filter(User.phone.in_(get_phone_variants(phone))).first() or \
            db.query(User.id).filter(User.phone_number.in_(get_phone_variants(phone))).first():
        raise HTTPException(status_code=409, detail="That phone number is already registered.")

    # Unlike a dealer typing someone else's number (users.py), the person redeeming this link IS the phone's
    # owner - they answer the WhatsApp code themselves, right before this call.
    redeem_phone_verification(db, phone, "registration", req.phone_verification_token)

    new_id = uuid.uuid4()
    depth = _dealer_depth(role, parent)
    if depth > MAX_DEALER_DEPTH:
        raise HTTPException(status_code=422, detail=f"Dealer sub-levels are limited to {MAX_DEALER_DEPTH}.")
    user = User(
        id=new_id,
        full_name=full_name,
        phone_number=phone,
        phone=phone,
        password_hash=hash_secret(req.password) if req.password else None,
        role=role,
        hierarchy_path=f"{(parent.hierarchy_path or parent_path).rstrip('/')}/{new_id}",
        parent_user_id=parent.id,
        dealer_depth=depth,
        org_role="owner",
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    try:
        db.flush()
        db.execute(
            update(InviteToken).where(InviteToken.id == invite_id).values(used_by_user_id=new_id)
        )
        # From here on this is the new account acting: the audit trail's row-level security only lets an actor
        # write their own rows.
        set_db_actor_context(db, user=user)
        via = {"role": role, "parent": str(parent.id), "via": "invite", "invited_by": str(inviter.id)}
        db.add(AuditLog(
            actor_id=user.id, actor_role=role, entity_type="user", entity_id=str(user.id), action="USER_CREATED",
            after_json=via,
        ))
        db.add(AuditLog(
            actor_id=user.id, actor_role=role, entity_type="invite", entity_id=str(invite_id), action="INVITATION_ACCEPTED",
            after_json=via,
        ))
        session = _issue_session(db, user, None, "Invite sign-up")
        session["status"] = "AUTHENTICATED"
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="That phone number is already registered.")
    return session


@router.get("/{token}/verify")
@router.post("/{token}/verify")
def verify_invite_token(token: str, db: Session = Depends(get_db)):
    """Verify that an invitation token is valid, active, and not yet redeemed."""
    link = db.query(InviteToken).filter(
        InviteToken.token_hash == hash_refresh_token(token),
        InviteToken.used_at.is_(None),
        InviteToken.expires_at > datetime.utcnow(),
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Invitation token is invalid, expired, or already used.")

    inviter = db.query(User).filter(User.id == link.created_by).first() if link.created_by else None
    return {
        "status": "VALID",
        "role": link.role,
        "invited_by": inviter.full_name if inviter else "Administrator",
        "expires_at": _utc_iso(link.expires_at),
        "password_required": link.role != "customer"
    }


@router.post("/{token}/accept")
def accept_invite_link(token: str, req: Dict[str, Any] = Body(...), db: Session = Depends(get_db)):
    """Accept an invitation, verify details, and create the authenticated session."""
    from app.services.invitation_service import InvitationService
    from app.schemas.invitation import InvitationAcceptRequest
    phone = req.get("phone") or req.get("phone_number")
    if not phone:
        # Fall back to legacy redeem_invite_link if PartnerInviteRedeem format
        from app.schemas import PartnerInviteRedeem
        try:
            pir = PartnerInviteRedeem(**req)
            return redeem_invite_link(token, pir, db)
        except Exception:
            raise HTTPException(status_code=422, detail="Phone number is required.")

    accept_req = InvitationAcceptRequest(
        phone=phone,
        full_name=req.get("full_name") or req.get("name") or "User",
        password=req.get("password"),
        otp=req.get("otp") or req.get("code"),
        phone_verification_token=req.get("phone_verification_token") or req.get("verification_token")
    )
    return InvitationService.accept_invitation(db, token, accept_req)


@router.post("/{id_or_token}/resend")
def resend_invite_notification(id_or_token: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Resend notification for an active invitation link."""
    from app.services.invitation_service import InvitationService
    return InvitationService.resend_invitation(db, current_user, id_or_token)


@router.post("/{id_or_token}/revoke")
def revoke_invite_link(id_or_token: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Revoke an active invitation token."""
    from app.services.invitation_service import InvitationService
    inv = InvitationService.revoke_invitation(db, current_user, id_or_token)
    return {"message": "Invitation revoked successfully", "id": str(inv.id), "status": inv.status}


organisations_router = APIRouter(tags=["Organisations"])

@organisations_router.post("/{org_id}/invitations")
@router.post("/organisations/{org_id}/invitations")
def create_org_invitation(
    org_id: str,
    req: Dict[str, Any],
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    POST /organisations/{id}/invitations
    Enforces organisation subtree boundaries, role authorization, and max 6-level dealer depth.
    """
    from app.services.invitation_service import InvitationService
    from app.schemas.invitation import InvitationCreate
    try:
        org_uuid = uuid.UUID(org_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid organisation ID format.")

    phone = req.get("phone") or req.get("phone_number")
    role = req.get("role") or "dealer"
    if not phone:
        raise HTTPException(status_code=422, detail="Phone number is required.")

    inv_create = InvitationCreate(phone=phone, role=role)
    inv, token = InvitationService.create_invitation(db, current_user, org_uuid, inv_create)
    return {
        "status": "INVITATION_CREATED",
        "message": "Invitation created successfully",
        "id": str(inv.id),
        "token": token,
        "phone": inv.phone,
        "role": inv.target_role or inv.role,
        "target_org_id": str(inv.target_org_id),
        "expires_at": _utc_iso(inv.expires_at)
    }
