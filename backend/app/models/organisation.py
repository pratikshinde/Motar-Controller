import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import Column, String, SmallInteger, DateTime, ForeignKey, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.types import LTree
from app.core.roles import OrgType, OrgStatus

SCHEMA = "agripump"

class Organisation(Base):
    __tablename__ = "organisations"
    __table_args__ = (
        CheckConstraint("depth >= 0 AND depth <= 10", name="ck_organisations_depth"),
        CheckConstraint("UPPER(type) IN ('SUPERADMIN', 'MANUFACTURER', 'DISTRIBUTOR', 'DEALER', 'ROOT')", name="ck_organisations_type"),
        {"schema": SCHEMA}
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    parent_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.organisations.id", ondelete="CASCADE"), nullable=True)
    type = Column(String(30), nullable=False)  # 'SUPERADMIN', 'MANUFACTURER', 'DISTRIBUTOR', 'DEALER' (or legacy lowercase)
    name = Column(String(150), nullable=False)
    path = Column(LTree, nullable=False, index=True)
    depth = Column(SmallInteger, nullable=False, default=0)
    status = Column(String(20), nullable=False, default="ACTIVE")
    branding_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.branding.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False
    )

    parent = relationship("Organisation", remote_side=[id], backref="children")
    branding = relationship("Branding", foreign_keys=[branding_id])

    @property
    def is_active(self) -> bool:
        return self.status == OrgStatus.ACTIVE.value

    @property
    def is_suspended(self) -> bool:
        return self.status == OrgStatus.SUSPENDED.value

    @property
    def is_disabled(self) -> bool:
        return self.status == OrgStatus.DISABLED.value
