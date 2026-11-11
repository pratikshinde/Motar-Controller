import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, SmallInteger, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base

SCHEMA = "agripump"


def _now() -> datetime:
    return datetime.now(timezone.utc)


class PumpSchedule(Base):
    """A pump's weekly schedule: on or off, and the time zone its "HH:MM" times are in."""

    __tablename__ = "pump_schedules"
    __table_args__ = {"schema": SCHEMA}

    pump_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE", onupdate="CASCADE"), primary_key=True)
    enabled = Column(Boolean, nullable=False, default=False)
    timezone = Column(String(50), nullable=False, default="Asia/Kolkata")
    updated_by = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"), nullable=True)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now, nullable=False)


class PumpScheduleEntry(Base):
    """One "on at 06:00, off at 09:00" on one weekday (0 = Monday). Times are 24-hour "HH:MM"."""

    __tablename__ = "pump_schedule_entries"
    __table_args__ = {"schema": SCHEMA}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pump_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False, index=True)
    day_of_week = Column(SmallInteger, nullable=False)
    on_time = Column(String(5), nullable=False)
    off_time = Column(String(5), nullable=False)
    enabled = Column(Boolean, nullable=False, default=True)


class PumpScheduleRun(Base):
    """A START or STOP that came due, and what became of it (PENDING until it is sent, skipped, or given up on)."""

    __tablename__ = "pump_schedule_runs"
    __table_args__ = (UniqueConstraint("pump_id", "kind", "due_at", name="uq_schedule_runs_due"), {"schema": SCHEMA})

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pump_id = Column(String(50), ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False)
    kind = Column(String(5), nullable=False)
    due_at = Column(DateTime(timezone=True), nullable=False)
    day_of_week = Column(SmallInteger, nullable=False)
    local_time = Column(String(5), nullable=False)
    outcome = Column(String(20), nullable=False, default="PENDING")
    detail = Column(Text, nullable=True)
    command_cid = Column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.commands.cid", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_now, onupdate=_now, nullable=False)
