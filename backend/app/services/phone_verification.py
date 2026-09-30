"""Prove a phone is real and reachable — for account registration and forgot-password (any account with a
password, farmer or partner), never the legacy farmer login OTP (still in `api/auth.py`'s `/send-otp` and
`/verify-otp`, unchanged, for whatever farmer accounts still use OTP-only login instead of a password).

Three steps, each a small, auditable unit:
  1. `start_phone_verification`  — send a code (WhatsApp today; `channel` is there for a future SMS option).
  2. `confirm_phone_verification` — check the code, mint a short-lived single-use ticket (never the OTP itself).
  3. `redeem_phone_verification`  — spend that ticket where the sensitive action actually happens (account
     creation, password reset) — kept separate from step 2 so "proved the phone" and "used that proof" are two
     distinct, auditable moments, the same shape `invite_tokens` already uses for onboarding links.
"""
import hashlib
import hmac
import logging
import random
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.config import settings
from app.core.phone import get_phone_variants, normalize_phone
from app.models import OtpChallenge, PhoneVerification, User
from app.services.notification_service import send_sms_otp, send_whatsapp_otp

logger = logging.getLogger("agripump.phone_verification")

RESEND_COOLDOWN_SECONDS = 30
OTP_TTL_MINUTES = 5
MAX_ATTEMPTS = 5


def _send(channel: str, phone: str, code: str) -> dict:
    return send_whatsapp_otp(phone, code) if channel == "whatsapp" else send_sms_otp(phone, code)


def start_phone_verification(db: Session, phone_number: str, purpose: str, channel: str = "whatsapp") -> dict:
    """Send a code. For `password_reset`, answers identically whether or not that phone belongs to a partner
    account — the caller cannot tell an unregistered number from one that just chose not to reveal it.
    """
    clean_phone = normalize_phone(phone_number)

    eligible = True
    if purpose == "password_reset":
        # Any account with a password is eligible (farmers included, now that they have one too - see
        # /auth/register). The response below must come out identical either way (same keys, same wording) -
        # an ineligible phone just skips the real work (no challenge row, no message actually sent) rather
        # than taking a visibly different shortcut, so the response shape itself cannot be used to tell an
        # unregistered number from an eligible one.
        account = db.query(User).filter(User.phone.in_(get_phone_variants(clean_phone))).first()
        eligible = (
            bool(account) and account.password_hash is not None
            and account.account_status == "ACTIVE" and account.is_active is not False
        )

    is_dev = getattr(settings, "ENV", "production") == "development"
    response = {"message": f"Verification code sent to {clean_phone}", "phone_number": clean_phone, "channel": channel}

    if eligible:
        existing = (
            db.query(OtpChallenge)
            .filter(OtpChallenge.phone_number == clean_phone, OtpChallenge.purpose == purpose, OtpChallenge.consumed_at.is_(None))
            .first()
        )
        now_utc = datetime.utcnow()
        if existing and existing.created_at and (now_utc - existing.created_at.replace(tzinfo=None)).total_seconds() < RESEND_COOLDOWN_SECONDS:
            retry_after = int(RESEND_COOLDOWN_SECONDS - (now_utc - existing.created_at.replace(tzinfo=None)).total_seconds())
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, f"Please wait {retry_after} seconds before requesting another code.")

        code = str(random.randint(100000, 999999))
        code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()
        expires_at = now_utc + timedelta(minutes=OTP_TTL_MINUTES)

        send_result = _send(channel, clean_phone, code)
        if send_result.get("status") not in ("dispatched", "mock_dispatched") and not is_dev:
            logger.warning("Phone verification send failed for purpose=%s channel=%s: %s", purpose, channel, send_result)
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "WhatsApp verification is not available right now. Please try again later or contact support.",
            )

        if existing:
            existing.code_hash = code_hash
            existing.channel = channel
            existing.expires_at = expires_at
            existing.attempts = 0
            existing.created_at = now_utc
        else:
            db.add(OtpChallenge(
                phone_number=clean_phone, purpose=purpose, channel=channel, code_hash=code_hash,
                expires_at=expires_at, attempts=0, created_at=now_utc,
            ))
        db.commit()
        if is_dev:
            response["dev_otp"] = code

    return response


def confirm_phone_verification(db: Session, phone_number: str, purpose: str, code: str) -> str:
    """Check the code; on success, consume the challenge and return a raw one-time ticket (store only its hash)."""
    clean_phone = normalize_phone(phone_number)
    challenge = (
        db.query(OtpChallenge)
        .filter(OtpChallenge.phone_number == clean_phone, OtpChallenge.purpose == purpose, OtpChallenge.consumed_at.is_(None))
        .first()
    )
    if not challenge:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No active verification code found. Please request a new one.")

    now = datetime.utcnow()
    if challenge.expires_at.replace(tzinfo=None) < now:
        challenge.consumed_at = now  # expired, not valid — but must not go on blocking a fresh send forever
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That code has expired. Please request a new one.")

    input_hash = hashlib.sha256(code.strip().encode("utf-8")).hexdigest()
    if not hmac.compare_digest(input_hash, challenge.code_hash):
        challenge.attempts = (challenge.attempts or 0) + 1
        if challenge.attempts >= MAX_ATTEMPTS:
            challenge.consumed_at = now
            db.commit()
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many incorrect attempts. Please request a new code.")
        db.commit()
        remaining = MAX_ATTEMPTS - challenge.attempts
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Incorrect code. {remaining} attempt{'s' if remaining != 1 else ''} remaining.")

    challenge.consumed_at = now
    raw_token = secrets.token_urlsafe(32)
    db.add(PhoneVerification(
        phone_number=clean_phone, purpose=purpose, token_hash=hashlib.sha256(raw_token.encode("utf-8")).hexdigest(),
        expires_at=now + timedelta(seconds=settings.PHONE_VERIFICATION_TTL_SECONDS),
    ))
    db.commit()
    return raw_token


def redeem_phone_verification(db: Session, phone_number: str, purpose: str, token: Optional[str]) -> None:
    """Spend a verification ticket. Raises if it is missing, wrong phone/purpose, expired, or already used —
    the same message for all of those, so which one it was cannot be probed for.
    """
    clean_phone = normalize_phone(phone_number)
    invalid = HTTPException(status.HTTP_400_BAD_REQUEST, "Phone verification is missing or has expired. Please verify your phone again.")
    if not token:
        raise invalid
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    ticket = (
        db.query(PhoneVerification)
        .filter(
            PhoneVerification.token_hash == token_hash, PhoneVerification.phone_number == clean_phone,
            PhoneVerification.purpose == purpose, PhoneVerification.consumed_at.is_(None),
            PhoneVerification.expires_at > datetime.utcnow(),
        )
        .first()
    )
    if not ticket:
        raise invalid
    ticket.consumed_at = datetime.utcnow()
    db.commit()
