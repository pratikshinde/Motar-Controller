import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Text, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.database import Base

SCHEMA = "agripump"


class AppBrand(Base):
    """One manufacturer's app ("ajanta", "swati", ...). Not the same as `Branding`, which is a signed-in partner's own
    portal colours. Holds no secrets: API tokens live in the environment as BRAND_<KEY>_<SETTING>."""
    __tablename__ = "brands"
    __table_args__ = {"schema": SCHEMA}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key = Column(String(30), nullable=False, unique=True)
    org_id = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.organisations.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(100), nullable=False)
    short_name = Column(String(30), nullable=True)
    logo_url = Column(Text, nullable=True)
    primary_color = Column(String(7), nullable=True)
    support_name = Column(String(100), nullable=True)
    support_phone = Column(String(20), nullable=True)
    support_email = Column(String(100), nullable=True)
    whatsapp_phone_id = Column(String(50), nullable=True)
    whatsapp_template = Column(String(60), nullable=True)
    whatsapp_language = Column(String(10), nullable=True)
    sms_sender_id = Column(String(11), nullable=True)
    msg91_flow_id = Column(String(60), nullable=True)
    android_package = Column(String(100), nullable=True)
    min_app_version = Column(String(20), nullable=True)
    features = Column(JSONB, nullable=False, default=dict)
    status = Column(String(10), nullable=False, default="ACTIVE")
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc), nullable=False)
