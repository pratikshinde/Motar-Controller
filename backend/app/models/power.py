import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base

SCHEMA = "agripump"


class PumpPowerEvent(Base):
    """The power came (ON) or went (OFF) at a pump. `source`: VOLTAGE (the starter reported its line voltages) or CONTACT (it stopped reporting)."""

    __tablename__ = "pump_power_events"
    __table_args__ = {"schema": SCHEMA}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pump_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False, index=True)
    state = Column(String(3), nullable=False)
    source = Column(String(10), nullable=False)
    occurred_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
