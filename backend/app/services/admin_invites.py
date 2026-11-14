"""Adding an admin (a manufacturer's login), so that nobody becomes an admin by accident and the email is really theirs.

1. The platform owner types the admin's name, company, address, phone and email. A 6-digit code is emailed to that address. Nothing else exists yet.
2. The admin reads the code out to the platform owner, who types it in. That proves the email, creates the manufacturer (from the company name) and the admin's
   account (no password yet).
3. The admin opens the website's Admin sign-in, chooses "First time here", types their email, the same code and a password of their own. The code is used up.
4. From then on they sign in with the email and that password. The code is never needed again.

If an admin forgets the password, the platform owner sends them a new code (reset) and they do step 3 again. The code lasts 24 hours, five wrong tries burn it, and
only a keyed hash of it is stored. On a developer machine with no real email set up the fixed code 123456 is accepted too.
"""
import hashlib
import hmac
import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.core.phone import get_phone_variants, india_phone
from app.models import AppBrand, User
from app.models.admin_invite import AdminInvite
from app.services import brand_service, email_service

logger = logging.getLogger("agripump.admin_invites")

CODE_HOURS = 24
MAX_ATTEMPTS = 5
MIN_PASSWORD = 10
DEV_CODE = "123456"
WAITING_FOR_CODE, WAITING_FOR_PASSWORD, DONE, EXPIRED, BLOCKED, CANCELLED = "WAITING_FOR_CODE", "WAITING_FOR_PASSWORD", "DONE", "EXPIRED", "BLOCKED", "CANCELLED"
WRONG = "That code is not right, or it has expired. Ask the platform owner for a new one."


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    return value if value is None or value.tzinfo else value.replace(tzinfo=timezone.utc)


def _clean_email(email: str) -> str:
    return (email or "").strip().lower()


def _hash(email: str, code: str) -> str:
    return hmac.new((settings.JWT_SECRET or "dev").encode("utf-8"), f"admin|{email}|{code}".encode("utf-8"), hashlib.sha256).hexdigest()


def _digits(code: str) -> str:
    return "".join(ch for ch in (code or "") if ch.isdigit())


def state_of(row: Optional[AdminInvite]) -> str:
    if row is None:
        return CANCELLED
    if row.completed_at is not None:
        return DONE
    if row.revoked_at is not None:
        return BLOCKED if (row.attempts or 0) >= MAX_ATTEMPTS else CANCELLED
    if _aware(row.expires_at) <= _now():
        return EXPIRED
    return WAITING_FOR_PASSWORD if row.verified_at is not None else WAITING_FOR_CODE


_NOISE_WORDS = re.compile(r"\b(pump|pumps|controller|controllers|private|pvt|ltd|limited)\b")


def _brand_key(db: Session, company: str) -> str:
    """A short, unique key for the manufacturer, made from the company name ("Swati Pumps Pvt Ltd" gives "swati")."""
    base = re.sub(r"[^a-z0-9]+", "-", _NOISE_WORDS.sub(" ", (company or "").lower())).strip("-")[:24].strip("-")
    if not base or not base[0].isalpha():
        base = ("m-" + base).strip("-")[:24]
    if len(base) < 2 or base in brand_service.RESERVED_KEYS:
        base = (base + "-co")[:24]
    key, n = base, 1
    while db.query(AppBrand.id).filter(AppBrand.key == key).first() is not None or key in brand_service.RESERVED_KEYS:
        n += 1
        key = f"{base}-{n}"
    return key


def _email_the_code(row: AdminInvite, code: str, why: str) -> None:
    try:
        email_service.send_email(
            row.email,
            "Your admin code",
            f"Hello {row.full_name.split()[0] if row.full_name.strip() else ''},\n\n{why}{(' (' + row.company_name + ')') if row.company_name else ''}\n\nYour code is {code}.\n\n"
            f"Read it out to the platform owner. Then open the website, choose Login, then Admin, then \"First time here\", and type your email, this same code and a "
            f"password of your own. The code works for {CODE_HOURS} hours and only once.\n\nIf you did not expect this email, ignore it.",
        )
    except email_service.EmailNotSent as exc:
        logger.error("An admin code could not be sent: %s", exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="The code could not be emailed. Check the email settings on the server and try again.")


def _new_code(row: AdminInvite) -> str:
    code = f"{secrets.randbelow(10**6):06d}"
    row.code_hash = _hash(row.email, code)
    row.expires_at = _now() + timedelta(hours=CODE_HOURS)
    row.attempts = 0
    row.revoked_at = None
    return code


# ---------------------------------------------------------------------------------------------------------------- the platform owner's side
def create(db: Session, owner: User, full_name: str, company_name: str, address: str, raw_phone: str, raw_email: str) -> AdminInvite:
    """Save a pending admin and email the code. Nothing but this exists until the owner has typed the code in."""
    name, company, where, email = (full_name or "").strip(), (company_name or "").strip(), (address or "").strip(), _clean_email(raw_email)
    if len(name) < 2:
        raise HTTPException(status_code=422, detail="Enter the admin's name.")
    if len(company) < 2:
        raise HTTPException(status_code=422, detail="Enter the company name.")
    if len(where) < 3:
        raise HTTPException(status_code=422, detail="Enter the address.")
    phone = india_phone(raw_phone or "")
    if not phone:
        raise HTTPException(status_code=422, detail="Enter the 10-digit phone number (the +91 is added for you).")
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=422, detail="Enter the admin's email address.")
    if db.query(User.id).filter(func.lower(User.email) == email).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That email already has an account.")
    variants = get_phone_variants(phone)
    if db.query(User.id).filter((User.phone.in_(variants)) | (User.phone_number.in_(variants))).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That phone number already has an account.")
    now = _now()
    db.query(AdminInvite).filter(AdminInvite.email == email, AdminInvite.completed_at.is_(None), AdminInvite.revoked_at.is_(None)).update({"revoked_at": now}, synchronize_session=False)
    row = AdminInvite(email=email, full_name=name, company_name=company, address=where, phone=phone, code_hash="x", created_by=owner.id, created_at=now, expires_at=now)
    code = _new_code(row)
    db.add(row)
    db.flush()
    _email_the_code(row, code, "You are being added as an admin")
    return row


def resend(db: Session, row: AdminInvite) -> None:
    """A new code for an invite that is not finished (the first was lost or expired)."""
    if state_of(row) == DONE:
        raise HTTPException(status_code=409, detail="This admin has already chosen a password. Use Reset password if they forgot it.")
    code = _new_code(row)
    _email_the_code(row, code, "Here is a new code.")


def start_reset(db: Session, owner: User, user: User) -> AdminInvite:
    """The admin forgot their password: a new code, with which they choose a new one the same way as the first time."""
    now = _now()
    email = _clean_email(user.email or "")
    if not email:
        raise HTTPException(status_code=422, detail="This account has no email address.")
    db.query(AdminInvite).filter(AdminInvite.email == email, AdminInvite.completed_at.is_(None), AdminInvite.revoked_at.is_(None)).update({"revoked_at": now}, synchronize_session=False)
    row = AdminInvite(email=email, full_name=user.full_name or "", brand_key=None, code_hash="x", created_by=owner.id, created_at=now, expires_at=now, verified_at=now, user_id=user.id)
    code = _new_code(row)
    db.add(row)
    db.flush()
    _email_the_code(row, code, "A new code was made for you so you can choose a new password.")
    return row


def _check(db: Session, row: Optional[AdminInvite], code: str) -> None:
    """Raise the one answer for any wrong code; five wrong tries burn the invite."""
    wrong = HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=WRONG)
    if row is None or state_of(row) not in (WAITING_FOR_CODE, WAITING_FOR_PASSWORD):
        raise wrong
    typed = _digits(code)
    dev_ok = settings.dev_codes_enabled and typed == DEV_CODE and not email_service.is_real()
    if not dev_ok and not (len(typed) == 6 and hmac.compare_digest(row.code_hash, _hash(row.email, typed))):
        row.attempts = (row.attempts or 0) + 1
        if row.attempts >= MAX_ATTEMPTS:
            row.revoked_at = _now()
        db.commit()
        raise wrong


def verify_by_owner(db: Session, owner: User, row: AdminInvite, code: str) -> User:
    """The owner typed the code the admin read out: the email is theirs, so the account is created (no password yet)."""
    if row.verified_at is not None and row.user_id is not None:
        return db.query(User).filter(User.id == row.user_id).one()
    _check(db, row, code)
    new_id = uuid.uuid4()
    key = _brand_key(db, row.company_name or row.full_name)
    short = ((row.company_name or key).split() or [key])[0].upper()[:30]
    db.add(AppBrand(key=key, name=(row.company_name or key)[:100], short_name=short, status="ACTIVE", features={}, support_phone=row.phone, support_email=row.email))
    db.flush()
    brand_service.forget(key)
    row.brand_key = key
    brand_id = brand_service.brand_id_for_new_account(db, "manufacturer", parent=owner, creator=owner, requested_key=key, explicit_for_manufacturer=True)
    user = User(
        id=new_id, full_name=row.full_name, email=row.email, phone=row.phone, phone_number=row.phone, address=row.address, password_hash=None, role="manufacturer",
        hierarchy_path=f"{(owner.hierarchy_path or '/SA').rstrip('/')}/{new_id}", parent_user_id=owner.id, dealer_depth=0,
        org_node_id=None, org_role="owner", brand_id=brand_id, account_status="ACTIVE", is_active=True, is_verified=True,
    )
    db.add(user)
    db.flush()
    brand = db.query(AppBrand).filter(AppBrand.id == brand_id, AppBrand.owner_user_id.is_(None)).first() if brand_id is not None else None
    if brand is not None:
        # The first admin of a brand IS that manufacturer: its tree is the manufacturer's dashboard.
        brand.owner_user_id = user.id
    row.verified_at = _now()
    row.user_id = user.id
    return user


# --------------------------------------------------------------------------------------------------------------------- the admin's side
def set_password(db: Session, raw_email: str, code: str, password: str, hash_password) -> User:
    """The admin's own password, chosen with the code from their email. Uses the code up."""
    if len(password or "") < MIN_PASSWORD:
        # Checked first so a short password does not use up the code.
        raise HTTPException(status_code=422, detail=f"Choose a password of at least {MIN_PASSWORD} characters.")
    email = _clean_email(raw_email)
    row = (
        db.query(AdminInvite)
        .filter(AdminInvite.email == email, AdminInvite.verified_at.isnot(None), AdminInvite.completed_at.is_(None), AdminInvite.revoked_at.is_(None))
        .order_by(AdminInvite.created_at.desc())
        .first()
    )
    _check(db, row, code)
    user = db.query(User).filter(User.id == row.user_id, User.role == "manufacturer").first() if row and row.user_id else None
    if user is None or not user.is_active or user.status == "SUSPENDED" or user.account_status == "SUSPENDED":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=WRONG)
    user.password_hash = hash_password(password)
    user.is_verified = True
    row.completed_at = _now()
    return user
