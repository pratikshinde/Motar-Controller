import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base

SCHEMA = "agripump"

class DeviceAccess(Base):
    __tablename__ = "device_access"
    __table_args__ = (
        UniqueConstraint("user_id", "device_id", name="uq_device_access_user_device"),
        {"schema": SCHEMA}
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="CASCADE"), nullable=False)
    device_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    role = Column(String(20), nullable=False, default="owner")  # 'owner', 'viewer', 'operator'
    nickname = Column(String(100), nullable=True)
    site_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.sites.id", ondelete="SET NULL"), nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
