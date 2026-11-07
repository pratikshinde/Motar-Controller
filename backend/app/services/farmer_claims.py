"""The QR code a dealer hands a farmer.

The QR holds a random secret (`AGP-CLAIM:<secret>`). The database keeps only its hash. A QR works once, expires, and a new QR for
the same farmer revokes the older ones, so a photographed or lost QR is useless afterwards. On top of the QR the app asks the farmer
for their registered mobile number; five wrong numbers burn the QR.
"""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.models.farmer_claim import FarmerClaim

CLAIM_PREFIX = "AGP-CLAIM:"
CLAIM_DAYS = 30
MAX_PHONE_ATTEMPTS = 5


def _now() -> datetime:
    return datetime.now(timezone.utc)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def payload_for(token: str) -> str:
    """What is printed in the QR."""
    return CLAIM_PREFIX + token


def token_from_payload(payload: str) -> Optional[str]:
    """The secret inside a scanned QR, or None when the QR is not one of ours."""
    text = (payload or "").strip()
    if not text.startswith(CLAIM_PREFIX):
        return None
    token = text[len(CLAIM_PREFIX):].strip()
    return token if 20 <= len(token) <= 128 else None


def issue_claim(db: Session, farmer_id, actor_id, days: int = CLAIM_DAYS) -> tuple[FarmerClaim, str]:
    """A new QR for this farmer: every older one that is still open is revoked. Returns the row and the raw secret (shown once)."""
    now = _now()
    db.query(FarmerClaim).filter(
        FarmerClaim.user_id == farmer_id, FarmerClaim.claimed_at.is_(None), FarmerClaim.revoked_at.is_(None)
    ).update({"revoked_at": now}, synchronize_session=False)
    token = secrets.token_urlsafe(24)
    claim = FarmerClaim(user_id=farmer_id, token_hash=hash_token(token), created_by=actor_id, created_at=now, expires_at=now + timedelta(days=days))
    db.add(claim)
    db.flush()
    return claim, token


def state_of(claim: Optional[FarmerClaim], now: Optional[datetime] = None) -> str:
    """CLAIMED, REVOKED, EXPIRED, PENDING (waiting to be scanned) or NONE (no QR was ever issued)."""
    if claim is None:
        return "NONE"
    now = now or _now()
    if claim.claimed_at is not None:
        return "CLAIMED"
    if claim.revoked_at is not None:
        return "REVOKED"
    expires = claim.expires_at if claim.expires_at.tzinfo else claim.expires_at.replace(tzinfo=timezone.utc)
    if expires <= now:
        return "EXPIRED"
    return "PENDING"


def find_open_claim(db: Session, token: str) -> Optional[FarmerClaim]:
    """The claim for this secret, only while it can still be used (not claimed, not revoked, not expired)."""
    claim = db.query(FarmerClaim).filter(FarmerClaim.token_hash == hash_token(token)).first()
    return claim if state_of(claim) == "PENDING" else None
