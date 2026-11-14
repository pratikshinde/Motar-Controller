from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base

SCHEMA = "agripump"


class AdminInvite(Base):
    """An admin (a manufacturer's login) being added by the platform owner, or being given a new code after forgetting their password.

    A 6-digit code is emailed to the admin's address. The admin reads it out to the platform owner, who types it in: that proves the email and creates the account
    (with no password). The admin then opens the Admin sign-in and chooses a password with the same code, once. Only a keyed hash of the code is kept
    (see app/services/admin_invites.py)."""

    __tablename__ = "admin_invites"
    __table_args__ = (Index("ix_admin_invites_email", "email"), {"schema": SCHEMA})

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    email = Column(String(254), nullable=False)
    full_name = Column(String(100), nullable=False)
    company_name = Column(String(100), nullable=True)
    address = Column(Text, nullable=True)
    phone = Column(String(20), nullable=True)
    brand_key = Column(String(30), nullable=True)               # made when the owner confirms the code
    code_hash = Column(String(64), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    attempts = Column(Integer, nullable=False, default=0)
    verified_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="CASCADE"), nullable=True)
