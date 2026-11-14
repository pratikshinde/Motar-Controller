from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base

SCHEMA = "agripump"


class EmailLoginCode(Base):
    """A sign-in code emailed to an admin or the platform owner. Only a keyed hash of the code is kept; it works once, for a few minutes, and five wrong
    tries burn it (see app/services/email_login.py)."""

    __tablename__ = "email_login_codes"
    __table_args__ = (Index("ix_email_login_codes_email", "email"), {"schema": SCHEMA})

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    email = Column(String(254), nullable=False)
    code_hash = Column(String(64), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    attempts = Column(Integer, nullable=False, default=0)
    used_at = Column(DateTime(timezone=True), nullable=True)
