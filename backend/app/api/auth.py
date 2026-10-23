import uuid
import random
import hashlib
import hmac
from functools import lru_cache
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from typing import Optional, Union
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.config import settings
from app.database import get_db
from app.models import User, OtpChallenge, RefreshToken, Invite, DeviceAccess, AccountDeletionRequest, AuditLog, Alert, Organisation
from app.schemas import (
    SendOtpRequest, VerifyOtpRequest, LoginPasswordRequest,
    RefreshTokenRequest, MfaVerifyRequest, MfaCodeRequest, RegisterRequest,
    InviteCreateRequest, PhoneVerificationSendRequest, PhoneVerificationConfirmRequest,
    ResetPasswordRequest, OtpRequestIn, OtpVerifyIn, RegisterRequestIn, RegisterVerifyIn
)
from app.services.jwt_auth import (
    sign_token, verify_token, generate_refresh_token,
    hash_refresh_token, verify_secret, hash_secret
)
from app.services.totp_service import (
    generate_secret, build_otpauth_url, generate_qr_base64, verify_totp
)
from app.services.whatsapp_provider import get_whatsapp_provider
from app.core.authorization import (
    can, can_create_role, normalize_role, is_super_admin,
    ROLE_SUPER_ADMIN, ROLE_PANEL_MANUFACTURER, ROLE_DISTRIBUTOR,
    ROLE_DEALER, ROLE_SUPPORT_ENGINEER, ROLE_END_USER, MAX_DEALER_DEPTH
)
from app.services.notification_service import send_sms_otp
from app.services.phone_verification import (
    start_phone_verification, confirm_phone_verification, redeem_phone_verification,
)
from app.services.cache_service import cache_service
from app.api.deps import get_current_user, require_roles, set_db_actor_context, security, HTTPAuthorizationCredentials
from app.repositories import PumpRepository
from app.services.pump_view import build_user_views
from app.schemas.farmer import (
    UserOut, LoginResponse, RefreshResponse, UpdateMeRequest, LogoutRequest, MessageResponse,
    SessionsResponse, DeletionRequestIn, DeletionRequestOut, DeletionRequestState, ExportResponse,
)
from app.core.errors import AppError

MFA_MAX_ATTEMPTS = 5

router = APIRouter(tags=["Authentication"])

def format_user_response(user: User):
    return {
        "id": str(user.id),
        "full_name": user.full_name,
        "phone_number": user.phone_number or user.phone,
        "phone": user.phone or user.phone_number,
        "email": user.email,
        "role": user.role,
        "dealer_depth": user.dealer_depth,
        "hierarchy_path": user.hierarchy_path,
        "org_id": str(user.org_id) if user.org_id else None,
        "preferred_language": user.preferred_language,
        "locale": user.locale,
        "mfa_enabled": bool(user.mfa_enabled),
        "status": user.status or "ACTIVE",
        "account_status": user.account_status or "ACTIVE",
    }

def _record_audit_log(
    db: Session,
    actor_id: Optional[uuid.UUID],
    actor_role: Optional[str],
    entity_type: str,
    entity_id: str,
    action: str,
    after_json: Optional[dict] = None
):
    """Safely record security audit event within PostgreSQL row-level security constraints."""
    try:
        if not actor_id:
            db.execute(text("SELECT set_config('app.bypass_rls', 'on', true)"))
        else:
            db.execute(text("SELECT set_config('app.user_id', :uid, true)"), {"uid": str(actor_id)})
            db.execute(text("SELECT set_config('app.user_role', :role, true)"), {"role": actor_role or "customer"})
        db.add(AuditLog(
            actor_id=actor_id,
            actor_role=actor_role,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            after_json=after_json
        ))
    except Exception:
        pass

def _session_version(user: User) -> int:
    """The version new tokens must carry: at least the cache's and the account's, so a cache that was flushed can
    never leave a signed-in person holding tokens the account check refuses."""
    return max(cache_service.get_user_session_version(str(user.id)), getattr(user, "session_version", 1) or 1)


def _issue_session(db: Session, user: User, app_install_id: Optional[str] = None, device_info: Optional[str] = None) -> dict:
    """Access + rotating refresh tokens for a signed-in user.
    Access tokens are short-lived (15 minutes as per SRS FR-SEC-024).
    """
    session_ver = _session_version(user)
    access_token = sign_token({
        "sub": str(user.id),
        "role": user.role,
        "hierarchy_path": user.hierarchy_path,
        "session_ver": session_ver
    }, expires_in_seconds=15 * 60)
    raw_refresh = generate_refresh_token()
    db.add(RefreshToken(
        user_id=user.id,
        family_id=uuid.uuid4(),
        token_hash=hash_refresh_token(raw_refresh),
        app_install_id=app_install_id,
        device_info=device_info or "Web/Mobile Client",
        last_used_at=datetime.utcnow(),
        expires_at=datetime.utcnow() + timedelta(days=30)
    ))
    user_data = format_user_response(user)
    return {
        "status": "AUTHENTICATED",
        "access_token": access_token,
        "refresh_token": raw_refresh,
        "token": access_token,
        "refreshToken": raw_refresh,
        "token_type": "bearer",
        "expires_in": 15 * 60,
        "mfa_setup_required": bool(normalize_role(user.role) == ROLE_SUPER_ADMIN and not user.mfa_enabled),
        "user": user_data,
        "session": {
            "access_token": access_token,
            "refresh_token": raw_refresh,
            "token_type": "bearer",
            "expires_in": 15 * 60
        }
    }

def _mfa_challenge_response(user: User) -> dict:
    """First factor passed for an account that must still pass the authenticator step."""
    challenge_id = str(uuid.uuid4())
    cache_service.set(f"mfa_challenge:{challenge_id}", str(user.id), ex=300)
    temp_token = sign_token(
        {"sub": str(user.id), "mfa_pending": True, "challenge_id": challenge_id, "role": user.role},
        expires_in_seconds=300,
    )
    return {
        "status": "MFA_REQUIRED",
        "mfa_required": True,
        "requires_mfa": True,
        "challenge_id": challenge_id,
        "temp_token": temp_token,
        "user": format_user_response(user),
    }


def _needs_mfa_challenge(user: User) -> bool:
    """A super admin who has enrolled an authenticator must present it at every sign-in. One who has not yet enrolled gets a
    setup-only session instead (`mfa_setup_required`), so they can enrol: demanding a code they cannot yet produce would
    lock them out of ever setting MFA up."""
    return bool(user.mfa_enabled and user.totp_secret)


# Password sign-in: this many wrong passwords for one number locks it for LOGIN_LOCK_SECONDS. Counted for unknown numbers
# too, so a lock (and the 401 before it) reveals nothing about whether an account exists.
LOGIN_MAX_FAILURES = 5
LOGIN_LOCK_SECONDS = 900


@lru_cache(maxsize=1)
def _dummy_password_hash() -> str:
    return hash_secret("no-such-account")


def _login_fail_key(clean_phone: str) -> str:
    return f"login_fail:{normalize_phone(clean_phone)[-10:]}"


def _send_login_code(phone: str, code: str) -> bool:
    """Deliver a sign-in code: WhatsApp first, SMS when WhatsApp is not set up or refuses. True when some channel took the
    message (on a developer machine the console mock counts: that is how it "delivers"). False when nothing could send it,
    so the caller can say so instead of telling the person a code is on its way when it is not."""
    try:
        sent = get_whatsapp_provider().send_otp(phone, code) or {}
        if sent.get("status") not in ("not_configured", "send_failed"):
            return True
    except Exception:
        pass
    try:
        sent = send_sms_otp(phone, code) or {}
    except Exception:
        return False
    # send_sms_otp answers "mock_dispatched" when no gateway is configured at all.
    return sent.get("status") != "mock_dispatched" or settings.dev_codes_enabled


def _open_to_codes(db: Session, clean_phone: str) -> bool:
    """With self-registration closed (always, in production) a sign-in code is only useful to a number that already has an
    account. Sending one to any other number is how an OTP endpoint gets abused to message strangers, so those get no code."""
    if settings.ALLOW_SELF_REGISTRATION:
        return True
    return db.query(User.id).filter(User.phone.in_(get_phone_variants(clean_phone))).first() is not None


# Re-exported for existing callers (e.g. `api/invites.py`) that import it from here; the definition itself
# now lives in app/core/phone.py so services can reach it without importing a router module.
from app.core.phone import get_phone_variants, normalize_phone  # noqa: E402,F401

@router.post("/otp/request")
@router.post("/send-otp")
def send_otp(req: Union[OtpRequestIn, SendOtpRequest], db: Session = Depends(get_db)):
    raw_phone = getattr(req, "phone", None) or getattr(req, "phone_number", None) or ""
    clean_phone = raw_phone.strip().replace(" ", "")
    if not clean_phone or len(clean_phone) < 10:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A valid mobile phone number is required."
        )

    # Check if user already exists
    user = db.query(User).filter(User.phone.in_(get_phone_variants(clean_phone))).first()
    is_new_user = (user is None)

    # With self-registration closed (always, in production) a sign-in code is only useful to an existing account. Do not
    # send WhatsApp messages to arbitrary numbers (that is how an OTP endpoint gets abused), and answer exactly as if one
    # had been sent, so the response does not reveal which numbers have accounts.
    if is_new_user and not _open_to_codes(db, clean_phone):
        return {
            "status": "OTP_REQUESTED",
            "message": f"Verification code dispatched to {clean_phone} via WhatsApp",
            "phone": clean_phone,
            "phone_number": clean_phone,
            "channel": "whatsapp",
            "cooldown_seconds": 30,
        }

    # Rate limiting: max 1 OTP request every 30 seconds per phone
    challenge = db.query(OtpChallenge).filter(
        OtpChallenge.phone_number.in_(get_phone_variants(clean_phone)),
        OtpChallenge.purpose == "login",
        OtpChallenge.consumed_at.is_(None)
    ).first()
    now_utc = datetime.utcnow()
    if challenge and challenge.created_at:
        challenge_created = challenge.created_at.replace(tzinfo=None)
        if (now_utc - challenge_created).total_seconds() < 30:
            retry_after = int(30 - (now_utc - challenge_created).total_seconds())
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {retry_after} seconds before requesting another OTP."
            )

    is_dev = settings.dev_codes_enabled
    otp_code = "123456" if is_dev else str(random.randint(100000, 999999))
    otp_hash = hashlib.sha256(otp_code.encode("utf-8")).hexdigest()
    expires_at = now_utc + timedelta(minutes=5)

    # Clean up previous challenges for this phone so old consumed records don't conflict
    db.query(OtpChallenge).filter(
        OtpChallenge.phone_number.in_(get_phone_variants(clean_phone))
    ).delete(synchronize_session=False)

    challenge = OtpChallenge(
        phone_number=clean_phone,
        purpose="login",
        channel="whatsapp",
        code_hash=otp_hash,
        expires_at=expires_at,
        attempts=0,
        consumed_at=None,
        created_at=now_utc
    )
    db.add(challenge)

    # Security audit event
    _record_audit_log(
        db,
        user.id if user else None,
        user.role if user else None,
        "auth",
        clean_phone,
        "OTP_REQUESTED",
        {"channel": "whatsapp", "is_new_user": is_new_user}
    )
    db.commit()

    if not _send_login_code(clean_phone, otp_code):
        # Nothing could send it. Drop the code (it would only block a retry for the cooldown) and say so.
        db.delete(challenge)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="We could not send a verification code right now. Please try again in a few minutes."
        )

    response_data = {
        "status": "OTP_REQUESTED",
        "message": f"Verification code dispatched to {clean_phone} via WhatsApp",
        "phone": clean_phone,
        "phone_number": clean_phone,
        "channel": "whatsapp",
        "cooldown_seconds": 30
    }
    # The code itself is only ever returned on a developer machine (ENV=development).
    if settings.dev_codes_enabled:
        response_data["dev_otp"] = otp_code

    return response_data

@router.post("/otp/verify")
@router.post("/verify-otp")
def verify_otp(req: Union[OtpVerifyIn, VerifyOtpRequest], db: Session = Depends(get_db)):
    raw_phone = getattr(req, "phone", None) or getattr(req, "phone_number", None) or ""
    clean_phone = raw_phone.strip().replace(" ", "")
    code = getattr(req, "otp", None) or getattr(req, "otp_code", None) or ""
    clean_code = str(code).strip()

    if not clean_phone or not clean_code:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Phone number and verification code are required."
        )

    input_hash = hashlib.sha256(clean_code.encode("utf-8")).hexdigest()

    # 1. Single-use enforcement: check if code was already consumed
    already_used = db.query(OtpChallenge).filter(
        OtpChallenge.phone_number.in_(get_phone_variants(clean_phone)),
        OtpChallenge.code_hash == input_hash,
        OtpChallenge.consumed_at.isnot(None)
    ).first()
    if already_used:
        raise HTTPException(
            status_code=400,
            detail="This verification code has already been used."
        )

    # 2. Check active unconsumed challenge
    challenge = db.query(OtpChallenge).filter(
        OtpChallenge.phone_number.in_(get_phone_variants(clean_phone)),
        OtpChallenge.purpose == "login",
        OtpChallenge.consumed_at.is_(None)
    ).first()
    if not challenge:
        raise HTTPException(
            status_code=400,
            detail="No active OTP challenge found. Please request a new code."
        )

    # 3. Check expiration (5 minutes max TTL as per SRS)
    if challenge.expires_at.replace(tzinfo=None) < datetime.utcnow():
        db.delete(challenge)
        db.commit()
        raise HTTPException(
            status_code=400,
            detail="This verification code has expired. Please request a new code."
        )

    # 4. Constant-time comparison of hashed OTP
    is_dev = settings.dev_codes_enabled
    is_mock_match = is_dev and clean_code == "123456"

    if not hmac.compare_digest(input_hash, challenge.code_hash) and not is_mock_match:
        challenge.attempts = (challenge.attempts or 0) + 1
        if challenge.attempts >= 5:
            db.delete(challenge)
            _record_audit_log(
                db,
                None,
                None,
                "auth",
                clean_phone,
                "OTP_FAILED",
                {"reason": "ATTEMPTS_EXCEEDED"}
            )
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many attempts. Please request a new code."
            )
        db.commit()
        remaining = 5 - challenge.attempts
        raise HTTPException(
            status_code=400,
            detail=f"Incorrect verification code. {remaining} attempt{'s' if remaining != 1 else ''} remaining."
        )

    # 5. Invalidate OTP immediately upon successful verification (single-use)
    challenge.consumed_at = datetime.utcnow()
    _record_audit_log(
        db,
        None,
        None,
        "auth",
        clean_phone,
        "OTP_VERIFIED",
        {"phone": clean_phone}
    )
    db.commit()

    # 6. Lookup user
    user = db.query(User).filter(User.phone.in_(get_phone_variants(clean_phone))).first()
    is_new = False
    if not user:
        # A code only proves the person holds this phone. Creating an account from it is self-registration, which is
        # closed in production (onboarding is by dealer invite), so it must obey the same switch as /auth/register.
        if not settings.ALLOW_SELF_REGISTRATION:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No account exists for this number. Accounts are created by your dealer."
            )
        is_new = True
        new_id = uuid.uuid4()
        user = User(
            id=new_id,
            phone=clean_phone,
            phone_number=clean_phone,
            full_name=f"Farmer {clean_phone[-4:]}",
            role=ROLE_END_USER,
            status="ACTIVE",
            account_status="ACTIVE",
            # Unique per account: the last four digits of a phone number are shared by thousands of people.
            hierarchy_path=f"/customers/{new_id}",
            preferred_language=getattr(req, "language", None) or "en",
            is_active=True,
            is_verified=True,
            created_at=datetime.utcnow()
        )
        db.add(user)
        db.flush()

    set_db_actor_context(db, user=user)

    # 7. Check account status: account suspension must immediately deny access
    if getattr(user, "status", "ACTIVE") == "SUSPENDED" or getattr(user, "account_status", "ACTIVE") == "SUSPENDED":
        _record_audit_log(
            db,
            user.id,
            user.role,
            "user",
            str(user.id),
            "LOGIN_FAILED",
            {"reason": "ACCOUNT_SUSPENDED"}
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is suspended. Please contact your administrator."
        )

    # 8. SUPER ADMIN REQUIREMENT: Super Admin MUST complete Authenticator App MFA
    if normalize_role(user.role) == ROLE_SUPER_ADMIN:
        challenge_id = str(uuid.uuid4())
        cache_service.set(f"mfa_challenge:{challenge_id}", str(user.id), ex=300)
        temp_token = sign_token({
            "sub": str(user.id),
            "mfa_pending": True,
            "challenge_id": challenge_id,
            "role": user.role
        }, expires_in_seconds=300)

        _record_audit_log(
            db,
            user.id,
            user.role,
            "user",
            str(user.id),
            "MFA_REQUIRED",
            {"challenge_id": challenge_id}
        )
        db.commit()

        return {
            "status": "MFA_REQUIRED",
            "challenge_id": challenge_id,
            "temp_token": temp_token,
            "requires_mfa": True,
            "user": format_user_response(user)
        }

    # Auto-redeem pending invites for this phone number
    pending_invites = (
        db.query(Invite)
        .filter(
            Invite.phone.in_(get_phone_variants(clean_phone)),
            Invite.status == "PENDING",
            Invite.expires_at > datetime.utcnow()
        )
        .all()
    )
    for inv in pending_invites:
        if inv.device_id:
            existing_access = (
                db.query(DeviceAccess)
                .filter(DeviceAccess.user_id == user.id, DeviceAccess.device_id == inv.device_id)
                .first()
            )
            if not existing_access:
                new_access = DeviceAccess(
                    id=uuid.uuid4(),
                    user_id=user.id,
                    device_id=inv.device_id,
                    role=inv.role or "viewer",
                    nickname=None
                )
                db.add(new_access)
        inv.status = "ACCEPTED"
        inv.redeemed_at = datetime.utcnow()

    # Normal roles: authenticated immediately
    session = _issue_session(db, user, req.app_install_id, req.device_info or "Web/Mobile App")
    session["is_new_user"] = is_new

    db.add(AuditLog(
        actor_id=user.id,
        actor_role=user.role,
        entity_type="user",
        entity_id=str(user.id),
        action="LOGIN_SUCCESS",
        after_json={"channel": "whatsapp", "phone": clean_phone}
    ))
    db.commit()
    return session

@router.post("/verify-phone/send")
def verify_phone_send(req: PhoneVerificationSendRequest, db: Session = Depends(get_db)):
    """Send a WhatsApp code to prove a phone: `registration` (before the account behind it is created) or
    `password_reset` (a partner proving they still hold the phone on file before setting a new password).
    Never the everyday farmer login OTP — that is `/send-otp`, unchanged, and stays SMS.
    """
    return start_phone_verification(db, req.phone_number, req.purpose, channel="whatsapp")


@router.post("/verify-phone/confirm")
def verify_phone_confirm(req: PhoneVerificationConfirmRequest, db: Session = Depends(get_db)):
    """Check the code; on success returns a one-time ticket that the actual account-creation or
    password-reset call must present — proving the phone and acting on that proof are kept as two steps.
    """
    token = confirm_phone_verification(db, req.phone_number, req.purpose, req.code)
    return {"verification_token": token}


@router.post("/reset-password", response_model=MessageResponse)
def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db)):
    """Set a new password for any account that has one (farmers now included — see `/auth/register`), after
    `/verify-phone/confirm` proved the phone (purpose `password_reset`).
    Every existing session for the account is signed out, the same as a password change or suspension already
    does elsewhere.
    """
    redeem_phone_verification(db, req.phone_number, "password_reset", req.verification_token)

    clean_phone = req.phone_number.strip().replace(" ", "")
    user = db.query(User).filter(User.phone.in_(get_phone_variants(clean_phone))).first()
    if not user:
        # The ticket was real (redeemed above), but the account behind that phone is gone by now - tell the
        # truth rather than pretend success.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found.")

    user.password_hash = hash_secret(req.new_password)
    cache_service.increment_user_session_version(str(user.id))
    user.session_version = (user.session_version or 1) + 1
    # Bumping the version only retires access tokens: /auth/refresh would happily mint a fresh one at the NEW version for
    # any refresh token still alive. A reset exists to lock out whoever else holds the account, so end every session.
    db.query(RefreshToken).filter(
        RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None)
    ).update({"revoked_at": datetime.utcnow()}, synchronize_session=False)
    cache_service.delete(_login_fail_key(req.phone_number))
    # No session/JWT exists yet at this point - the ticket alone proved the phone. Set the actor context to the
    # resolved user so the audit row's row-level security (which only lets an actor write their own rows) passes.
    set_db_actor_context(db, user=user)
    db.add(AuditLog(actor_id=user.id, actor_role=user.role, entity_type="user", entity_id=str(user.id),
                     action="PASSWORD_RESET"))  # audit_log.action is varchar(30) — keep every action name short
    db.commit()
    return {"message": "Password updated. Please sign in with your new password."}


@router.post("/login-password", response_model=LoginResponse)
def login_password(req: LoginPasswordRequest, db: Session = Depends(get_db)):
    clean_phone = req.phone_number.strip().replace(" ", "")

    fail_key = _login_fail_key(clean_phone)
    failures = int(cache_service.get(fail_key) or 0)
    if failures >= LOGIN_MAX_FAILURES:
        raise AppError(
            code="LOGIN_LOCKED", message_key="errors.login_locked", status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many wrong passwords. Wait a few minutes, or reset your password.",
            headers={"Retry-After": str(LOGIN_LOCK_SECONDS)},
        )

    user = db.query(User).filter(
        (User.phone.in_(get_phone_variants(clean_phone))) |
        (User.phone_number.in_(get_phone_variants(clean_phone)))
    ).first()

    # One password check is always paid for (against a dummy hash when there is no such account or no password), and
    # "no such number" gets the same answer as "wrong password": neither the status code, the message nor the timing
    # says which phone numbers have accounts.
    stored = user.password_hash if user and user.password_hash else None
    password_ok = verify_secret(req.password, stored or _dummy_password_hash()) and stored is not None
    if not user or not password_ok:
        cache_service.set(fail_key, failures + 1, ex=LOGIN_LOCK_SECONDS)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect mobile number or password. Please check and try again."
        )
    cache_service.delete(fail_key)

    if user.status == "SUSPENDED" or user.account_status == "SUSPENDED":
        raise HTTPException(status_code=403, detail="Account suspended")

    if _needs_mfa_challenge(user):
        return _mfa_challenge_response(user)

    session = _issue_session(db, user, req.app_install_id, req.device_info)
    db.commit()
    return session

@router.post("/refresh", response_model=RefreshResponse)
def refresh_token(req: RefreshTokenRequest, db: Session = Depends(get_db)):
    token_hash = hash_refresh_token(req.refresh_token)
    rec = db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).first()

    if not rec or rec.expires_at.replace(tzinfo=None) < datetime.utcnow():
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    # Reuse Detection (FR-SEC-024): A reused revoked token revokes the entire token family!
    if rec.revoked_at is not None:
        db.query(RefreshToken).filter(RefreshToken.family_id == rec.family_id).update({"revoked_at": datetime.utcnow()})
        cache_service.increment_user_session_version(str(rec.user_id))
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Compromised refresh token reused. All active sessions in family revoked."
        )

    # Device binding check
    if rec.app_install_id and req.app_install_id and rec.app_install_id != req.app_install_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token bound to different device installation."
        )

    user = db.query(User).filter(User.id == rec.user_id).first()
    if not user or user.status == "SUSPENDED" or user.account_status == "SUSPENDED":
        raise HTTPException(status_code=401, detail="User inactive or suspended")

    # Rotate refresh token within the same family
    now_utc = datetime.utcnow()
    rec.revoked_at = now_utc
    rec.last_used_at = now_utc

    new_raw_refresh = generate_refresh_token()
    new_rec = RefreshToken(
        user_id=user.id,
        family_id=rec.family_id,
        token_hash=hash_refresh_token(new_raw_refresh),
        app_install_id=req.app_install_id or rec.app_install_id,
        device_info=req.device_info or rec.device_info,
        last_used_at=now_utc,
        expires_at=now_utc + timedelta(days=30)
    )
    db.add(new_rec)
    rec.replaced_by = new_rec.id
    db.commit()

    session_ver = _session_version(user)
    access_token = sign_token({
        "sub": str(user.id),
        "role": user.role,
        "hierarchy_path": user.hierarchy_path,
        "session_ver": session_ver
    })

    return {
        "access_token": access_token,
        "refresh_token": new_raw_refresh
    }

@router.post("/logout", response_model=MessageResponse)
def logout(
    req: Optional[LogoutRequest] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    now = datetime.utcnow()
    if req and req.refresh_token:
        # Sign out THIS phone only: end the session the refresh token belongs to and leave the
        # farmer's other devices signed in.
        rec = (
            db.query(RefreshToken)
            .filter(
                RefreshToken.token_hash == hash_refresh_token(req.refresh_token),
                RefreshToken.user_id == current_user.id,
            )
            .first()
        )
        if rec:
            db.query(RefreshToken).filter(
                RefreshToken.user_id == current_user.id,
                RefreshToken.family_id == rec.family_id,
                RefreshToken.revoked_at.is_(None),
            ).update({"revoked_at": now})
            db.commit()
        return {"message": "Logged out successfully"}

    # No token supplied: end every session. Bumping the session version invalidates
    # outstanding access tokens within 60 s (FR-CLD-041).
    cache_service.increment_user_session_version(str(current_user.id))
    current_user.session_version = (getattr(current_user, "session_version", 1) or 1) + 1
    db.query(RefreshToken).filter(
        RefreshToken.user_id == current_user.id,
        RefreshToken.revoked_at.is_(None)
    ).update({"revoked_at": now})
    db.commit()
    return {"message": "Logged out successfully"}

@router.get("/me/sessions", response_model=SessionsResponse)
def list_sessions(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """List active session families for current user."""
    active_tokens = (
        db.query(RefreshToken)
        .filter(RefreshToken.user_id == current_user.id, RefreshToken.revoked_at.is_(None))
        .order_by(RefreshToken.created_at.desc())
        .all()
    )
    # Deduplicate by family_id
    seen_families = set()
    sessions = []
    for t in active_tokens:
        if t.family_id not in seen_families:
            seen_families.add(t.family_id)
            sessions.append({
                "family_id": str(t.family_id),
                "device_info": t.device_info or "Unknown Client",
                "app_install_id": t.app_install_id,
                "created_at": t.created_at.isoformat() if t.created_at else None,
                "last_used_at": t.last_used_at.isoformat() if t.last_used_at else None,
            })
    return {"sessions": sessions}

@router.delete("/me/sessions/{family_id}", response_model=MessageResponse)
def revoke_session(family_id: uuid.UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Revoke a specific session family for current user."""
    affected = (
        db.query(RefreshToken)
        .filter(RefreshToken.user_id == current_user.id, RefreshToken.family_id == family_id)
        .update({"revoked_at": datetime.utcnow()})
    )
    db.commit()
    if not affected:
        raise HTTPException(status_code=404, detail="Session family not found")
    return {"message": "Session revoked successfully"}

@router.post("/invites")
def create_invite(
    req: InviteCreateRequest,
    current_user: User = Depends(require_roles(["dealer", "distributor", "manufacturer", "superadmin"])),
    db: Session = Depends(get_db)
):
    """Create a device access invite for a farmer phone number."""
    invite_token = uuid.uuid4().hex + uuid.uuid4().hex
    clean_phone = req.phone.strip().replace(" ", "")
    invite = Invite(
        token=invite_token,
        parent_user_id=current_user.id,
        invited_by=current_user.id,
        phone=clean_phone,
        device_id=req.device_id,
        role=req.role,
        status="PENDING",
        created_at=datetime.utcnow(),
        expires_at=datetime.utcnow() + timedelta(days=7)
    )
    db.add(invite)
    db.commit()
    return {
        "message": "Invite created successfully",
        "token": invite_token,
        "phone": clean_phone,
        "device_id": req.device_id,
        "role": req.role,
        "expires_at": invite.expires_at.isoformat()
    }

@router.post("/mfa/enroll")
@router.post("/mfa/setup")
def mfa_enroll(
    req: Optional[MfaVerifyRequest] = None,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db)
):
    # Try resolving user from Bearer credentials, temp_token or challenge_id
    user = None
    if credentials and credentials.credentials:
        payload = verify_token(credentials.credentials)
        if payload and payload.get("sub"):
            user = db.query(User).filter(User.id == payload["sub"]).first()

    if not user and req and (req.temp_token or req.challenge_id):
        token_str = req.temp_token or req.challenge_id
        payload = verify_token(token_str)
        if payload and payload.get("sub"):
            user = db.query(User).filter(User.id == payload["sub"]).first()
        else:
            cached_id = cache_service.get(f"mfa_challenge:{token_str}")
            if cached_id:
                user = db.query(User).filter(User.id == cached_id).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Valid authentication session or challenge token required for MFA enrollment."
        )

    # Enrolment can be started from a first-factor challenge (the super admin who has no authenticator yet has nothing else
    # to present). It must therefore never be allowed to REPLACE an authenticator that is already active: otherwise anyone
    # who learned the password could swap in their own secret and then pass the second factor. Changing an active
    # authenticator goes through /mfa/disable, which needs a valid current code.
    if user.mfa_enabled and user.totp_secret:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An authenticator is already set up for this account. Remove it with a valid code before setting up a new one."
        )

    secret = generate_secret()
    # Save the secret temporarily on user so first code can activate it
    user.totp_secret = secret
    db.commit()

    phone_str = user.phone_number or user.phone or "superadmin"
    url = build_otpauth_url(secret, phone_str)
    qr = generate_qr_base64(url)
    return {
        "status": "MFA_ENROLLING",
        "secret": secret,
        "otpauth_url": url,
        "qr_code": qr
    }

@router.post("/mfa/enable")
def mfa_enable(
    req: MfaCodeRequest,
    secret: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if current_user.mfa_enabled and current_user.totp_secret:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An authenticator is already enabled. Disable it with a valid code before setting up a new one."
        )
    secret = req.secret or secret or current_user.totp_secret
    if not secret:
        raise HTTPException(status_code=422, detail="secret is required")
    if not verify_totp(secret, req.code):
        raise HTTPException(status_code=400, detail="Invalid code. MFA setup failed.")
    current_user.totp_enabled = True
    current_user.totp_secret = secret
    _record_audit_log(
        db,
        current_user.id,
        current_user.role,
        "user",
        str(current_user.id),
        "MFA_SUCCESS"
    )
    db.commit()
    return {"message": "MFA enabled successfully"}

@router.post("/mfa/disable")
def mfa_disable(
    req: MfaCodeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not current_user.totp_secret or not verify_totp(current_user.totp_secret, req.code):
        raise HTTPException(status_code=400, detail="Invalid MFA code")
    current_user.totp_enabled = False
    current_user.totp_secret = None
    db.commit()
    return {"message": "MFA disabled"}

@router.post("/mfa/verify")
def mfa_verify(req: MfaVerifyRequest, db: Session = Depends(get_db)):
    token = req.temp_token or req.challenge_id
    if not token:
        raise HTTPException(status_code=401, detail="temp_token or challenge_id is required")

    user_id = None
    payload = verify_token(token)
    if payload and payload.get("mfa_pending"):
        user_id = payload.get("sub")
    else:
        cached_id = cache_service.get(f"mfa_challenge:{token}")
        if cached_id:
            user_id = cached_id

    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid MFA challenge session")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    code = req.totp_code or req.code
    if not code:
        raise HTTPException(status_code=422, detail="Verification code is required")

    # Lockout check: maximum 5 wrong attempts
    fail_key = f"mfa_fail:{user.id}"
    failures = int(cache_service.get(fail_key) or 0)
    if failures >= MFA_MAX_ATTEMPTS:
        raise AppError(
            code="MFA_LOCKED", message_key="errors.mfa_locked", status_code=429,
            detail="Too many wrong codes. Wait a few minutes and sign in again.",
            headers={"Retry-After": "300"},
        )

    code_str = str(code).strip()
    is_dev = settings.dev_codes_enabled
    is_mock_code = is_dev and code_str == "123456"

    totp_valid = False
    if user.totp_secret:
        totp_valid = verify_totp(user.totp_secret, code_str)

    if not totp_valid and is_mock_code:
        totp_valid = True
        if not user.totp_secret:
            user.totp_secret = generate_secret()

    if not totp_valid:
        if not user.totp_secret:
            raise HTTPException(status_code=400, detail="MFA not configured on account. Please enroll MFA first.")
        cache_service.set(fail_key, failures + 1, ex=300)
        _record_audit_log(
            db,
            user.id,
            user.role,
            "user",
            str(user.id),
            "MFA_FAILED"
        )
        db.commit()
        raise HTTPException(status_code=400, detail="Invalid MFA verification code")

    cache_service.delete(fail_key)
    if token:
        cache_service.delete(f"mfa_challenge:{token}")
    user.totp_enabled = True
    user.mfa_enabled = True

    _record_audit_log(
        db,
        user.id,
        user.role,
        "user",
        str(user.id),
        "MFA_SUCCESS"
    )
    _record_audit_log(
        db,
        user.id,
        user.role,
        "user",
        str(user.id),
        "LOGIN_SUCCESS"
    )
    session = _issue_session(db, user)
    db.commit()
    return session

@router.post("/logout-all", response_model=MessageResponse)
def logout_all(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Revoke all sessions and invalidate all active access tokens within 60 seconds (FR-CLD-041)."""
    now = datetime.utcnow()
    cache_service.increment_user_session_version(str(current_user.id))
    current_user.session_version = (getattr(current_user, "session_version", 1) or 1) + 1
    db.query(RefreshToken).filter(
        RefreshToken.user_id == current_user.id,
        RefreshToken.revoked_at.is_(None)
    ).update({"revoked_at": now})
    db.add(AuditLog(
        actor_id=current_user.id,
        actor_role=current_user.role,
        entity_type="user",
        entity_id=str(current_user.id),
        action="LOGOUT_ALL"
    ))
    db.commit()
    return {"message": "All sessions logged out successfully"}

@router.post("/register/request")
def register_request(req: RegisterRequestIn, db: Session = Depends(get_db)):
    """Request a WhatsApp OTP for phone registration with server-side role validation."""
    raw_phone = req.phone or req.phone_number or ""
    clean_phone = raw_phone.strip().replace(" ", "")
    if not clean_phone or len(clean_phone) < 10:
        raise HTTPException(status_code=422, detail="A valid mobile phone number is required.")

    target_role = normalize_role(req.role)

    # Server-side authorization check: Prevent unauthorized creation of privileged roles
    if target_role == ROLE_SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super Admin accounts cannot be created via public registration."
        )

    # Privileged partner roles require an onboarding invite
    if target_role in (ROLE_PANEL_MANUFACTURER, ROLE_DISTRIBUTOR, ROLE_DEALER, ROLE_SUPPORT_ENGINEER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Registration for role '{target_role}' requires an authorized onboarding invite link."
        )

    # Self-registration closed: only a number that already has an account gets a code, and the answer is the same either way.
    if not _open_to_codes(db, clean_phone):
        return {
            "status": "OTP_REQUESTED",
            "message": f"Registration OTP sent to {clean_phone} via WhatsApp",
            "phone": clean_phone,
            "role": target_role,
            "cooldown_seconds": 30
        }

    # Rate limiting: max 1 OTP request every 30 seconds
    challenge = db.query(OtpChallenge).filter(
        OtpChallenge.phone_number == clean_phone,
        OtpChallenge.purpose == "registration",
        OtpChallenge.consumed_at.is_(None)
    ).first()
    now_utc = datetime.utcnow()
    if challenge and challenge.created_at:
        challenge_created = challenge.created_at.replace(tzinfo=None)
        if (now_utc - challenge_created).total_seconds() < 30:
            retry_after = int(30 - (now_utc - challenge_created).total_seconds())
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {retry_after} seconds before requesting another OTP."
            )

    is_dev = settings.dev_codes_enabled
    otp_code = "123456" if is_dev else str(random.randint(100000, 999999))
    otp_hash = hashlib.sha256(otp_code.encode("utf-8")).hexdigest()
    expires_at = now_utc + timedelta(minutes=5)

    if challenge:
        challenge.code_hash = otp_hash
        challenge.expires_at = expires_at
        challenge.attempts = 0
        challenge.created_at = now_utc
        challenge.channel = "whatsapp"
    else:
        challenge = OtpChallenge(
            phone_number=clean_phone,
            purpose="registration",
            channel="whatsapp",
            code_hash=otp_hash,
            expires_at=expires_at,
            attempts=0,
            created_at=now_utc
        )
        db.add(challenge)

    # Not db.add(AuditLog(actor_id=None, ...)): with no signed-in actor the audit table's row-level security refuses the row
    # (and this route answered 500) unless the bypass is set first, which is what the helper does.
    _record_audit_log(
        db, None, None, "auth", clean_phone, "OTP_REQUESTED",
        {"channel": "whatsapp", "purpose": "registration", "role": target_role}
    )
    db.commit()

    if not _send_login_code(clean_phone, otp_code):
        db.delete(challenge)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="We could not send a verification code right now. Please try again in a few minutes."
        )

    response_data = {
        "status": "OTP_REQUESTED",
        "message": f"Registration OTP sent to {clean_phone} via WhatsApp",
        "phone": clean_phone,
        "role": target_role,
        "cooldown_seconds": 30
    }
    if settings.dev_codes_enabled:
        response_data["dev_otp"] = otp_code

    return response_data

@router.post("/register/verify")
def register_verify(req: RegisterVerifyIn, db: Session = Depends(get_db)):
    """Verify registration WhatsApp OTP and create account."""
    raw_phone = req.phone or req.phone_number or ""
    clean_phone = raw_phone.strip().replace(" ", "")
    code = req.otp or req.otp_code or ""
    clean_code = str(code).strip()

    if not clean_phone or not clean_code:
        raise HTTPException(status_code=422, detail="Phone number and OTP code are required.")

    input_hash = hashlib.sha256(clean_code.encode("utf-8")).hexdigest()

    # Look up challenge
    challenge = db.query(OtpChallenge).filter(
        OtpChallenge.phone_number == clean_phone,
        OtpChallenge.purpose == "registration",
        OtpChallenge.consumed_at.is_(None)
    ).first()
    if not challenge:
        # Fallback to login challenge if registered through main flow
        challenge = db.query(OtpChallenge).filter(
            OtpChallenge.phone_number == clean_phone,
            OtpChallenge.purpose == "login",
            OtpChallenge.consumed_at.is_(None)
        ).first()

    if not challenge:
        raise HTTPException(status_code=400, detail="No active registration OTP found.")

    if challenge.expires_at.replace(tzinfo=None) < datetime.utcnow():
        db.delete(challenge)
        db.commit()
        raise HTTPException(status_code=400, detail="Verification code expired. Please request a new code.")

    is_dev = settings.dev_codes_enabled
    is_mock_match = is_dev and clean_code == "123456"

    if not hmac.compare_digest(input_hash, challenge.code_hash) and not is_mock_match:
        challenge.attempts = (challenge.attempts or 0) + 1
        if challenge.attempts >= 5:
            db.delete(challenge)
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many attempts. Please request a new code."
            )
        db.commit()
        raise HTTPException(status_code=400, detail="Incorrect verification code.")

    challenge.consumed_at = datetime.utcnow()

    # Check if phone is already registered
    existing = db.query(User).filter(User.phone.in_(get_phone_variants(clean_phone))).first()
    if existing:
        # Proving the phone is not signing in. Whoever holds the number gets the same rules as every other sign-in:
        # a suspended account is refused, and a super admin still has to pass the authenticator step (a code alone must
        # never be a way round it).
        if existing.status == "SUSPENDED" or existing.account_status == "SUSPENDED":
            db.commit()
            raise HTTPException(status_code=403, detail="Your account is suspended. Please contact your administrator.")
        if normalize_role(existing.role) == ROLE_SUPER_ADMIN or _needs_mfa_challenge(existing):
            db.commit()
            return _mfa_challenge_response(existing)
        session = _issue_session(db, existing, req.app_install_id, req.device_info)
        db.commit()
        return session

    if not settings.ALLOW_SELF_REGISTRATION:
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Self-registration is disabled. Onboarding is by dealer invite only."
        )

    target_role = normalize_role(req.role)
    if target_role in (ROLE_SUPER_ADMIN, ROLE_PANEL_MANUFACTURER, ROLE_DISTRIBUTOR, ROLE_DEALER):
        raise HTTPException(status_code=403, detail="Privileged roles cannot be created via public registration.")

    user_id = uuid.uuid4()
    full_name = (req.full_name or "").strip() or f"User {clean_phone[-4:]}"
    new_user = User(
        id=user_id,
        phone=clean_phone,
        phone_number=clean_phone,
        full_name=full_name,
        role=ROLE_END_USER,
        hierarchy_path=f"/customers/{user_id}",
        account_status="ACTIVE",
        is_active=True,
        is_verified=True,
        created_at=datetime.utcnow()
    )
    db.add(new_user)
    db.flush()

    db.add(AuditLog(
        actor_id=new_user.id,
        actor_role=new_user.role,
        entity_type="user",
        entity_id=str(new_user.id),
        action="ACCOUNT_CREATED",
        after_json={"phone": clean_phone, "role": ROLE_END_USER}
    ))

    session = _issue_session(db, new_user, req.app_install_id, req.device_info)
    session["status"] = "AUTHENTICATED"
    db.commit()
    return session

@router.post("/register")
def register_user(req: RegisterRequest, db: Session = Depends(get_db)):
    if not settings.ALLOW_SELF_REGISTRATION:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Self-registration is disabled. Onboarding is by dealer invite only."
        )

    phone_input = req.phone_number or req.phone
    clean_phone = phone_input.strip().replace(" ", "") if phone_input else None
    clean_email = req.email.strip().lower() if req.email else None

    if not clean_phone and not clean_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one of phone number or email must be provided"
        )

    if clean_phone:
        existing_phone = db.query(User).filter(User.phone.in_(get_phone_variants(clean_phone))).first()
        if existing_phone:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Phone number is already registered"
            )

    if clean_email:
        existing_email = db.query(User).filter(User.email == clean_email).first()
        if existing_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email address is already registered"
            )

    phone_verified = False
    if clean_phone:
        # An account with a phone number proves it first: WhatsApp code -> single-use ticket (see /verify-phone/*). No
        # ticket, no account; otherwise anyone could register, and be treated as "verified", on a number they do not own.
        redeem_phone_verification(db, clean_phone, "registration", req.phone_verification_token)
        phone_verified = True

    user_id = uuid.uuid4()
    password_h = hash_secret(req.password) if req.password else None

    new_user = User(
        id=user_id,
        full_name=req.full_name.strip(),
        phone=clean_phone,
        phone_number=clean_phone,
        email=clean_email,
        password_hash=password_h,
        role="customer",
        hierarchy_path=f"/customers/{user_id}",
        is_active=True,
        is_verified=phone_verified
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    session = _issue_session(db, new_user)
    db.commit()
    return session

@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return format_user_response(current_user)

# Languages the app UI is translated into (mobile/src/shared/i18n/languages.ts).
SUPPORTED_LOCALES = ("en", "hi", "mr", "kn", "te", "ta", "gu", "pa", "bn", "as", "ne", "kok", "mai", "ks")

@router.patch("/me", response_model=UserOut)
def update_me(
    req: UpdateMeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save the user's language (so push / SMS / voice replies use it too) and/or display name."""
    if req.locale is None and req.full_name is None:
        raise HTTPException(status_code=422, detail="Nothing to update")
    if req.locale is not None:
        if req.locale not in SUPPORTED_LOCALES:
            raise HTTPException(
                status_code=422,
                detail=f"Unsupported language. Use one of: {', '.join(SUPPORTED_LOCALES)}",
            )
        current_user.locale = req.locale
        current_user.preferred_language = req.locale
    if req.full_name is not None:
        name = req.full_name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Name cannot be empty")
        current_user.full_name = name
    db.commit()
    return format_user_response(current_user)


def _deletion_out(rec: AccountDeletionRequest, message: Optional[str] = None) -> dict:
    return {
        "id": rec.id,
        "status": rec.status,
        "requested_at": rec.requested_at.isoformat() if rec.requested_at else "",
        "message": message,
    }


@router.get("/me/deletion-request", response_model=DeletionRequestState)
def get_deletion_request(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rec = (
        db.query(AccountDeletionRequest)
        .filter(AccountDeletionRequest.user_id == current_user.id)
        .order_by(AccountDeletionRequest.requested_at.desc())
        .first()
    )
    return {"request": _deletion_out(rec) if rec else None}


@router.post("/me/deletion-request", response_model=DeletionRequestOut, status_code=201)
def create_deletion_request(
    req: DeletionRequestIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """DPDP "delete my data" request. Staff complete it; the account is NOT removed instantly, so a
    stray tap cannot destroy a farmer's pump history."""
    existing = (
        db.query(AccountDeletionRequest)
        .filter(AccountDeletionRequest.user_id == current_user.id, AccountDeletionRequest.status == "PENDING")
        .first()
    )
    if existing:
        return _deletion_out(existing, "A deletion request is already open.")

    rec = AccountDeletionRequest(user_id=current_user.id, reason=(req.reason or None))
    db.add(rec)
    db.add(AuditLog(
        actor_id=current_user.id,
        actor_role=current_user.role,
        entity_type="USER",
        entity_id=str(current_user.id),
        action="ACCOUNT_DELETION_REQUESTED",
        before_json=None,
        after_json={"reason": req.reason},
    ))
    db.commit()
    db.refresh(rec)
    return _deletion_out(rec, "Your request was received. Our team will contact you before anything is deleted.")


@router.get("/me/export", response_model=ExportResponse)
def export_my_data(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Everything the account holds about the caller, as one JSON document (DPDP right of access)."""
    repo = PumpRepository.for_actor(actor=current_user, db=db)
    pumps = repo.list(page=1, limit=100)
    views = build_user_views(db, current_user, pumps)
    pump_rows = []
    for p in pumps:
        v = views.get(p.id, {})
        pump_rows.append({
            "id": p.id,
            "name": p.name,
            "nickname": v.get("nickname"),
            "site": v.get("site_name"),
            "access_role": v.get("access_role"),
            "status": p.status,
            "lifecycle_state": p.lifecycle_state,
            "firmware_version": p.firmware_version,
            "hp_rating": float(p.hp_rating) if p.hp_rating is not None else None,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        })

    ids = [p.id for p in pumps]
    alerts = (
        db.query(Alert).filter(Alert.pump_id.in_(ids)).order_by(Alert.last_occurred_at.desc()).limit(500).all()
        if ids else []
    )
    alert_rows = [{
        "id": str(a.id),
        "pump_id": a.pump_id,
        "alert_type": a.alert_type,
        "severity": a.severity,
        "fault_code": a.fault_code,
        "occurrence_count": a.occurrence_count,
        "first_occurred_at": a.first_occurred_at.isoformat() if a.first_occurred_at else None,
        "last_occurred_at": a.last_occurred_at.isoformat() if a.last_occurred_at else None,
        "acknowledged_at": a.acknowledged_at.isoformat() if a.acknowledged_at else None,
        "resolved_at": a.resolved_at.isoformat() if a.resolved_at else None,
        "resolution_note": a.resolution_note,
    } for a in alerts]

    sessions = list_sessions(current_user=current_user, db=db)["sessions"]
    return {
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "user": format_user_response(current_user),
        "pumps": pump_rows,
        "alerts": alert_rows,
        "sessions": sessions,
        "note": "Raw sensor readings are not included; ask your dealer for a full history report.",
    }
