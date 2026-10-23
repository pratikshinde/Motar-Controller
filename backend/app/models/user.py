import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import String, Boolean, DateTime, Integer, SmallInteger, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base

SCHEMA = "agripump"

class User(Base):
    __tablename__ = "users"
    __table_args__ = {"schema": SCHEMA, "extend_existing": True}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    full_name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String(100), unique=True, nullable=True, index=True)
    phone_number: Mapped[Optional[str]] = mapped_column(String(20), unique=True, nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(20), unique=True, nullable=True)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(30), nullable=False)
    hierarchy_path: Mapped[str] = mapped_column(Text, nullable=False)
    parent_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)
    dealer_depth: Mapped[int] = mapped_column(SmallInteger, default=0, nullable=False)
    org_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.organisations.id", ondelete="SET NULL"), nullable=True)
    session_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    locale: Mapped[str] = mapped_column(String(10), default="en", nullable=False)
    preferred_language: Mapped[Optional[str]] = mapped_column(String(10), default="en", nullable=True)
    totp_secret: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Partner accounts (manufacturer / distributor / dealer / support): the brand whose tree they belong to. Farmers: NULL.
    brand_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.brands.id", ondelete="SET NULL"), nullable=True)
    org_node_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)
    org_role: Mapped[Optional[str]] = mapped_column(String(10), default="owner", nullable=True)
    account_status: Mapped[str] = mapped_column(String(10), default="ACTIVE", nullable=False)
    contract_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    device_quota: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False
    )

    @property
    def name(self) -> str:
        return self.full_name

    @name.setter
    def name(self, val: str) -> None:
        self.full_name = val

    @property
    def mfa_enabled(self) -> bool:
        return self.totp_enabled

    @mfa_enabled.setter
    def mfa_enabled(self, val: bool) -> None:
        self.totp_enabled = bool(val)

    @property
    def status(self) -> str:
        return self.account_status or ("ACTIVE" if self.is_active else "INACTIVE")

    @status.setter
    def status(self, val: str) -> None:
        self.account_status = val
        self.is_active = (val == "ACTIVE")

    organisation = relationship("Organisation", foreign_keys=[org_id], backref="users")
