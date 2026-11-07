from datetime import datetime, timezone

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base

SCHEMA = "agripump"


class FarmerClaim(Base):
    """The QR code a dealer hands a farmer: scanning it once in the app gives that phone the farmer's account. Only a hash of the
    QR's secret is stored. One use, an expiry, and a newer QR for the same farmer revokes the older ones."""

    __tablename__ = "farmer_claims"
    __table_args__ = (UniqueConstraint("token_hash", name="uq_farmer_claims_token_hash"), {"schema": SCHEMA})

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(64), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    claimed_at = Column(DateTime(timezone=True), nullable=True)
    claimed_install_id = Column(String(100), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    attempts = Column(Integer, nullable=False, default=0)
