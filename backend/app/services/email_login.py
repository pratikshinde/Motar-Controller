"""Signing in with a code sent to the account's email: how the admin and the platform owner sign in. There is no password.

1. They type their email. If it belongs to an admin or the platform owner, a 6-digit code is emailed; whatever the email, the answer is the same, so nobody
   can learn which emails have accounts.
2. They type the code. It works once, for 10 minutes; five wrong tries burn it; no more than five codes are sent to one email in 15 minutes.
3. The platform owner then also enters the authenticator code (the existing second step); an admin is signed in.

Only a keyed hash of the code is stored. On a developer machine (ENV=development) the fixed code 123456 is accepted too, but only while emails are not really being sent (EMAIL_BACKEND=log).
"""
import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.models import User
from app.models.email_login_code import EmailLoginCode
from app.services import email_service

logger = logging.getLogger("agripump.email_login")

CODE_MINUTES = 10
MAX_ATTEMPTS = 5
MAX_SENDS = 5
SEND_WINDOW_MINUTES = 15
EMAIL_SIGN_IN_ROLES = ("superadmin", "manufacturer")
DEV_CODE = "123456"
WRONG = "That code is not right, or it has expired. Ask for a new one."


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    return value if value is None or value.tzinfo else value.replace(tzinfo=timezone.utc)


def clean_email(email: str) -> str:
    return (email or "").strip().lower()


def _hash(email: str, code: str) -> str:
    return hmac.new((settings.JWT_SECRET or "dev").encode("utf-8"), f"{email}|{code}".encode("utf-8"), hashlib.sha256).hexdigest()


def find_account(db: Session, email: str) -> Optional[User]:
    """The admin or platform owner this email signs in to (active, not suspended), or None."""
    if not email or "@" not in email:
        return None
    user = db.query(User).filter(func.lower(User.email) == email, User.role.in_(EMAIL_SIGN_IN_ROLES)).first()
    if user is None or not user.is_active or user.status == "SUSPENDED" or user.account_status == "SUSPENDED":
        return None
    return user


def request_code(db: Session, raw_email: str) -> None:
    """Email a code if the address belongs to an admin or the platform owner. Never says which; never raises for a stranger's address."""
    email = clean_email(raw_email)
    user = find_account(db, email)
    if user is None:
        return
    now = _now()
    recent = db.query(func.count(EmailLoginCode.id)).filter(
        EmailLoginCode.email == email, EmailLoginCode.created_at > now - timedelta(minutes=SEND_WINDOW_MINUTES)
    ).scalar() or 0
    if recent >= MAX_SENDS:
        logger.warning("Too many sign-in codes asked for one email; not sending another yet.")
        return
    # A new code replaces the older ones.
    db.query(EmailLoginCode).filter(EmailLoginCode.email == email, EmailLoginCode.used_at.is_(None)).update({"used_at": now}, synchronize_session=False)
    code = f"{secrets.randbelow(10**6):06d}"
    db.add(EmailLoginCode(email=email, code_hash=_hash(email, code), created_at=now, expires_at=now + timedelta(minutes=CODE_MINUTES), attempts=0))
    db.commit()
    try:
        email_service.send_email(
            email,
            "Your sign-in code",
            f"Your sign-in code is {code}.\n\nIt works once and for {CODE_MINUTES} minutes. If you did not ask for it, ignore this email: nobody can sign in without it.",
        )
    except email_service.EmailNotSent as exc:
        logger.error("A sign-in code could not be sent: %s", exc)


def verify_code(db: Session, raw_email: str, code: str) -> User:
    """The account, when the email and the code are right. Otherwise one answer, whatever was wrong."""
    email = clean_email(raw_email)
    code = "".join(ch for ch in (code or "") if ch.isdigit())
    wrong = HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=WRONG)
    user = find_account(db, email)
    if user is None or len(code) != 6:
        raise wrong
    # The development shortcut only stands in for the code when emails are not really being sent.
    if settings.dev_codes_enabled and code == DEV_CODE and not email_service.is_real():
        return user
    now = _now()
    row = (
        db.query(EmailLoginCode)
        .filter(EmailLoginCode.email == email, EmailLoginCode.used_at.is_(None))
        .order_by(EmailLoginCode.created_at.desc())
        .first()
    )
    if row is None or _aware(row.expires_at) <= now or (row.attempts or 0) >= MAX_ATTEMPTS:
        raise wrong
    if not hmac.compare_digest(row.code_hash, _hash(email, code)):
        row.attempts = (row.attempts or 0) + 1
        db.commit()
        raise wrong
    row.used_at = now
    return user
