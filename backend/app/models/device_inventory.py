"""
Phase 4 Device Inventory Models
=================================
Extends the existing Pump/AllocationLog/Panel infrastructure with:

DeviceOrgAllocationLog
    Org-level allocation chain of custody record. Records every ownership
    change at the organisation level (not user level).  Immutable.

PanelBindingHistory
    Tracks every panel serial binding/unbinding event per device, so there
    is a full history even though the Pump model only holds the current panel serial.

NOTE: The primary device model is Pump (existing). Do NOT create a
duplicate Device table. These models supplement — not replace — existing tables.
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Text, DateTime, ForeignKey, Index, BigInteger, Boolean
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base

SCHEMA = "agripump"


class DeviceOrgAllocationLog(Base):
    """
    Immutable org-level chain of custody for devices.

    Every allocation/reallocation/return is recorded here.
    Records MUST NOT be updated or deleted via public API.

    action values:
      ALLOCATED    - device assigned from from_org to to_org
      RETURNED     - device returned from to_org back up the hierarchy
      REASSIGNED   - device moved between orgs at same level (SA operation)
    """
    __tablename__ = "device_org_allocation_log"
    __table_args__ = (
        Index("idx_doal_device_id", "device_id"),
        Index("idx_doal_occurred_at", "occurred_at"),
        Index("idx_doal_to_org", "to_org_id"),
        Index("idx_doal_from_org", "from_org_id"),
        {"schema": SCHEMA},
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    device_id = Column(
        String(50),
        ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
    )
    from_org_id = Column(
        UUID(as_uuid=True),
        ForeignKey(f"{SCHEMA}.organisations.id", ondelete="SET NULL"),
        nullable=True,  # NULL = unallocated (OEM inventory)
    )
    to_org_id = Column(
        UUID(as_uuid=True),
        ForeignKey(f"{SCHEMA}.organisations.id", ondelete="SET NULL"),
        nullable=True,  # NULL = returned to OEM inventory
    )
    actor_id = Column(
        UUID(as_uuid=True),
        ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    action = Column(String(20), nullable=False, default="ALLOCATED")
    note = Column(Text, nullable=True)
    idempotency_key = Column(String(100), nullable=True, index=True)
    occurred_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    from_org = relationship("Organisation", foreign_keys=[from_org_id])
    to_org = relationship("Organisation", foreign_keys=[to_org_id])


class PanelBindingHistory(Base):
    """
    Immutable record of every panel serial binding/unbinding event.

    The current binding is always the row with unbound_at IS NULL.
    Never DELETE or UPDATE rows in this table.
    """
    __tablename__ = "panel_binding_history"
    __table_args__ = (
        Index("idx_pbh_device_id", "device_id"),
        {"schema": SCHEMA},
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    device_id = Column(
        String(50),
        ForeignKey(f"{SCHEMA}.pumps.id", ondelete="CASCADE", onupdate="CASCADE"),
        nullable=False,
    )
    panel_serial = Column(String(50), nullable=False)
    motor_rating = Column(String(50), nullable=True)
    starter_type = Column(String(30), nullable=True)
    pump_make = Column(String(50), nullable=True)
    pump_model = Column(String(50), nullable=True)
    bound_by = Column(
        UUID(as_uuid=True),
        ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    bound_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    unbound_at = Column(DateTime(timezone=True), nullable=True)
    unbound_by = Column(
        UUID(as_uuid=True),
        ForeignKey(f"{SCHEMA}.users.id", ondelete="SET NULL"),
        nullable=True,
    )
    note = Column(Text, nullable=True)

    device = relationship("Pump", foreign_keys=[device_id])
