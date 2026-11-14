from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base

SCHEMA = "agripump"


class PartnerRegistration(Base):
    """A distributor or dealer being registered. Nothing but this row exists until the new person has scanned the QR, typed their mobile number
    and chosen their own password; only then is the account made (see app/services/partner_registration.py)."""

    __tablename__ = "partner_registrations"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_partner_registrations_token_hash"),
        Index("ix_partner_registrations_parent_user_id", "parent_user_id"),
        Index("ix_partner_registrations_phone", "phone"),
        {"schema": SCHEMA},
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    role = Column(String(20), nullable=False)
    full_name = Column(String(100), nullable=False)
    address = Column(Text, nullable=False)
    phone = Column(String(20), nullable=False)
    parent_user_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)
    token_hash = Column(String(64), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    scanned_at = Column(DateTime(timezone=True), nullable=True)
    attempts = Column(Integer, nullable=False, default=0)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
