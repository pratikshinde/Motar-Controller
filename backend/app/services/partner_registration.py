"""Registering a distributor or a dealer, step by step, so that nobody becomes an account by accident.

1. The admin (or a distributor, for a dealer) types name, address and mobile number: a *pending registration* is saved and a QR is shown. No account yet.
2. The new person scans the QR. A one-time password is made at that moment and shown, once, on the admin's page.
3. The admin sends them the password (a call, a message).
4. They type their mobile number and that password on the page the QR opened. Only a right pair gets through (five wrong tries burn the QR).
5. They choose their own password, and only then is the account created and signed in. The admin never learns the password they chose.

The QR alone gets nothing: the password never travels on it. The password alone gets nothing: it is only made once the QR has been scanned, and it must come with
the registered mobile number. Only hashes of the QR secret, the password and the short-lived ticket between steps 4 and 5 are kept.
"""
import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.phone import get_phone_variants, india_phone
from app.models import User
from app.models.partner_registration import PartnerRegistration
from app.services import brand_service

REGISTRATION_HOURS = 24      # how long a QR can be scanned
CODE_HOURS = 24              # how long a password can be used once it exists
TICKET_MINUTES = 15          # from a right password to choosing one's own
MAX_ATTEMPTS = 5
MIN_PASSWORD = 8
PARTNER_ROLES = ("distributor", "dealer")
# No 0/O/1/I/L: the password is read out over a call.
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

WAITING, SCANNED, COMPLETED, EXPIRED, BLOCKED, CANCELLED = "WAITING", "SCANNED", "COMPLETED", "EXPIRED", "BLOCKED", "CANCELLED"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    return value if value is None or value.tzinfo else value.replace(tzinfo=timezone.utc)


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def new_code() -> str:
    """A one-time password like K7Q4-9MZB."""
    raw = "".join(secrets.choice(ALPHABET) for _ in range(8))
    return f"{raw[:4]}-{raw[4:]}"


def _normal_code(code: str) -> str:
    return "".join(ch for ch in (code or "").upper() if ch.isalnum())


def state_of(row: Optional[PartnerRegistration], now: Optional[datetime] = None) -> str:
    """WAITING (not scanned yet), SCANNED (the password exists; the admin sends it), COMPLETED, EXPIRED, BLOCKED (five wrong tries) or CANCELLED."""
    if row is None:
        return CANCELLED
    now = now or _now()
    if row.completed_at is not None:
        return COMPLETED
    if row.revoked_at is not None:
        return BLOCKED if (row.attempts or 0) >= MAX_ATTEMPTS else CANCELLED
    if _aware(row.expires_at) <= now:
        return EXPIRED
    return SCANNED if row.scanned_at is not None else WAITING


def is_open(row: Optional[PartnerRegistration]) -> bool:
    return state_of(row) in (WAITING, SCANNED)


def by_token(db: Session, token: str) -> Optional[PartnerRegistration]:
    token = (token or "").strip()
    if not (20 <= len(token) <= 128):
        return None
    return db.query(PartnerRegistration).filter(PartnerRegistration.token_hash == _hash(token)).first()


INVALID = "This link is not valid any more. Please ask the person who is registering you for a new QR code."


def _invalid() -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=INVALID)


# ------------------------------------------------------------------------------------------------------------- the admin's side
def create(db: Session, creator: User, parent: User, role: str, full_name: str, address: str, phone_raw: str) -> Tuple[PartnerRegistration, str]:
    """Save a pending registration and return it with the raw QR secret (shown once). Any older open registration for the same number is cancelled."""
    role = (role or "").lower()
    if role not in PARTNER_ROLES:
        raise HTTPException(status_code=422, detail="Only a distributor or a dealer is registered this way.")
    name, where = (full_name or "").strip(), (address or "").strip()
    if len(name) < 2:
        raise HTTPException(status_code=422, detail="Enter the person's name.")
    if len(where) < 3:
        raise HTTPException(status_code=422, detail="Enter the person's address.")
    phone = india_phone(phone_raw or "")
    if not phone:
        raise HTTPException(status_code=422, detail="Enter the 10-digit mobile number of the person you are registering.")
    variants = get_phone_variants(phone)
    if db.query(User.id).filter((User.phone.in_(variants)) | (User.phone_number.in_(variants))).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That mobile number is already registered.")
    now = _now()
    db.query(PartnerRegistration).filter(
        PartnerRegistration.phone.in_(variants), PartnerRegistration.completed_at.is_(None), PartnerRegistration.revoked_at.is_(None)
    ).update({"revoked_at": now}, synchronize_session=False)
    token = secrets.token_urlsafe(24)
    row = PartnerRegistration(
        role=role, full_name=name, address=where, phone=phone, parent_user_id=parent.id, created_by=creator.id,
        token_hash=_hash(token), created_at=now, expires_at=now + timedelta(hours=REGISTRATION_HOURS), attempts=0,
    )
    db.add(row)
    db.flush()
    return row, token


def new_qr(db: Session, row: PartnerRegistration) -> str:
    """A new QR for an open registration: the old one stops working and the person has to scan again."""
    if state_of(row) in (COMPLETED,):
        raise HTTPException(status_code=409, detail="This person is already registered.")
    now = _now()
    token = secrets.token_urlsafe(24)
    row.token_hash = _hash(token)
    row.revoked_at = None
    row.expires_at = now + timedelta(hours=REGISTRATION_HOURS)
    row.scanned_at = row.code_hash = row.code_plain = row.code_expires_at = row.code_revealed_at = None
    row.ticket_hash = row.ticket_expires_at = None
    row.attempts = 0
    return token


def new_password(db: Session, row: PartnerRegistration) -> None:
    """A fresh one-time password, for a registration that has been scanned (the first was lost, or the admin wants to start over)."""
    if state_of(row) != SCANNED:
        raise HTTPException(status_code=409, detail="The password can only be changed after the QR has been scanned.")
    _make_code(row)
    row.attempts = 0


def _make_code(row: PartnerRegistration) -> None:
    code = new_code()
    row.code_hash = _hash(_normal_code(code))
    row.code_plain = code
    row.code_expires_at = _now() + timedelta(hours=CODE_HOURS)
    row.code_revealed_at = None
    row.ticket_hash = row.ticket_expires_at = None


def reveal_to_admin(row: PartnerRegistration) -> Optional[str]:
    """The password, once: the admin's page shows it as soon as the QR is scanned, and it is forgotten from the clear after that."""
    if row.code_plain and state_of(row) == SCANNED:
        code = row.code_plain
        row.code_plain = None
        row.code_revealed_at = _now()
        return code
    return None


def cancel(row: PartnerRegistration) -> None:
    if state_of(row) == COMPLETED:
        raise HTTPException(status_code=409, detail="This person is already registered.")
    row.revoked_at = _now()
    row.code_plain = None


# --------------------------------------------------------------------------------------------------------- the new person's side
def scan(db: Session, token: str) -> PartnerRegistration:
    """The QR was opened: the registration is marked scanned and the one-time password is made (the admin's page then shows it)."""
    row = by_token(db, token)
    if row is None or not is_open(row):
        raise _invalid()
    if row.scanned_at is None:
        row.scanned_at = _now()
        _make_code(row)
    return row


def verify(db: Session, token: str, phone_raw: str, code: str) -> Tuple[str, PartnerRegistration]:
    """A right mobile number and password give a short-lived ticket to choose a password with. Five wrong tries burn the QR."""
    row = by_token(db, token)
    if row is None or state_of(row) != SCANNED or not row.code_hash:
        raise _invalid()
    now = _now()
    if row.code_expires_at is not None and _aware(row.code_expires_at) <= now:
        raise HTTPException(status_code=400, detail="That password has expired. Ask for a new one.")
    typed = india_phone(phone_raw or "")
    phone_ok = bool(typed) and typed in get_phone_variants(row.phone)
    code_ok = hmac.compare_digest(_hash(_normal_code(code)), row.code_hash)
    if not (phone_ok and code_ok):
        row.attempts = (row.attempts or 0) + 1
        burned = row.attempts >= MAX_ATTEMPTS
        if burned:
            row.revoked_at = now
            row.code_plain = None
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The mobile number or the password is not right." + (" This QR is now blocked: please ask for a new one." if burned else ""),
        )
    ticket = secrets.token_urlsafe(24)
    row.ticket_hash = _hash(ticket)
    row.ticket_expires_at = now + timedelta(minutes=TICKET_MINUTES)
    return ticket, row


def complete(db: Session, token: str, ticket: str, password: str) -> User:
    """Create the account, with the password the person chose. Nothing is created unless the QR was scanned and the password was right."""
    row = by_token(db, token)
    if row is None or state_of(row) != SCANNED or not row.ticket_hash or row.ticket_expires_at is None:
        raise _invalid()
    if _aware(row.ticket_expires_at) <= _now() or not hmac.compare_digest(_hash(ticket or ""), row.ticket_hash):
        raise HTTPException(status_code=400, detail="That took too long. Please type the mobile number and the password again.")
    if len(password or "") < MIN_PASSWORD:
        raise HTTPException(status_code=422, detail=f"Choose a password of at least {MIN_PASSWORD} characters.")
    parent = db.query(User).filter(User.id == row.parent_user_id).first()
    if parent is None:
        raise _invalid()
    variants = get_phone_variants(row.phone)
    if db.query(User.id).filter((User.phone.in_(variants)) | (User.phone_number.in_(variants))).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That mobile number is already registered.")

    from app.services.jwt_auth import hash_secret

    new_id = uuid.uuid4()
    role = row.role
    depth = (parent.dealer_depth + 1) if (role == "dealer" and parent.role == "dealer") else (1 if role == "dealer" else 0)
    user = User(
        id=new_id, full_name=row.full_name, phone=row.phone, phone_number=row.phone, address=row.address,
        password_hash=hash_secret(password), role=role,
        hierarchy_path=f"{(parent.hierarchy_path or '').rstrip('/')}/{new_id}", parent_user_id=parent.id, dealer_depth=depth,
        org_node_id=None, org_role="owner",
        brand_id=brand_service.brand_id_for_new_account(db, role, parent=parent, creator=parent, requested_key=None, explicit_for_manufacturer=True),
        account_status="ACTIVE", is_active=True, is_verified=False,
    )
    db.add(user)
    db.flush()
    row.completed_at = _now()
    row.user_id = user.id
    row.ticket_hash = row.ticket_expires_at = row.code_plain = None
    return user
