"""
Phase 4 - Part 1: Model migration + new fields + DeviceOrgAllocationLog
Writes:
  - app/models/device_inventory.py   (new allocation log + panel history models)
  - alembic/versions/phase4_device_inventory.py
"""
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(BASE, "app")

files = {}

# =========================================================
# New models: DeviceOrgAllocationLog + PanelBinding history
# We extend existing models, not replace them.
# =========================================================
files[os.path.join(APP, "models", "device_inventory.py")] = r'''"""
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
'''

# =========================================================
# Alembic migration: Phase 4 new tables + indexes
# =========================================================
files[os.path.join(BASE, "alembic", "versions", "phase4_device_inventory.py")] = r'''"""
Phase 4 Device Inventory Schema
================================
- Creates device_org_allocation_log table
- Creates panel_binding_history table
- Adds org_id-based device ownership indexes
- Adds lifecycle_state index with org scope

Set down_revision to your latest migration before running.

Revision: phase4_device_inventory
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "phase4_device_inventory"
down_revision = None   # Set to your current latest revision
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── DeviceOrgAllocationLog ───────────────────────────────────────────────
    op.create_table(
        "device_org_allocation_log",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("device_id", sa.String(50), sa.ForeignKey("agripump.pumps.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False),
        sa.Column("from_org_id", UUID(as_uuid=True), sa.ForeignKey("agripump.organisations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("to_org_id", UUID(as_uuid=True), sa.ForeignKey("agripump.organisations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("actor_id", UUID(as_uuid=True), sa.ForeignKey("agripump.users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("action", sa.String(20), nullable=False, server_default="ALLOCATED"),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("idempotency_key", sa.String(100), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        schema="agripump",
    )
    op.create_index("idx_doal_device_id", "device_org_allocation_log", ["device_id"], schema="agripump")
    op.create_index("idx_doal_occurred_at", "device_org_allocation_log", ["occurred_at"], schema="agripump")
    op.create_index("idx_doal_to_org", "device_org_allocation_log", ["to_org_id"], schema="agripump")
    op.create_index("idx_doal_from_org", "device_org_allocation_log", ["from_org_id"], schema="agripump")
    op.create_index("idx_doal_idempotency", "device_org_allocation_log", ["idempotency_key"], schema="agripump")

    # ── PanelBindingHistory ──────────────────────────────────────────────────
    op.create_table(
        "panel_binding_history",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("device_id", sa.String(50), sa.ForeignKey("agripump.pumps.id", ondelete="CASCADE", onupdate="CASCADE"), nullable=False),
        sa.Column("panel_serial", sa.String(50), nullable=False),
        sa.Column("motor_rating", sa.String(50), nullable=True),
        sa.Column("starter_type", sa.String(30), nullable=True),
        sa.Column("pump_make", sa.String(50), nullable=True),
        sa.Column("pump_model", sa.String(50), nullable=True),
        sa.Column("bound_by", UUID(as_uuid=True), sa.ForeignKey("agripump.users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("bound_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("unbound_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("unbound_by", UUID(as_uuid=True), sa.ForeignKey("agripump.users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="agripump",
    )
    op.create_index("idx_pbh_device_id", "panel_binding_history", ["device_id"], schema="agripump")

    # ── Additional Phase 4 query indexes ────────────────────────────────────
    op.execute("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pumps_org_lifecycle
        ON agripump.pumps (org_id, lifecycle_state)
    """)
    op.execute("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pumps_serial_search
        ON agripump.pumps (id varchar_pattern_ops)
    """)
    op.execute("""
        CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_pumps_id
        ON agripump.pumps (id)
    """)


def downgrade() -> None:
    op.drop_index("idx_doal_idempotency", "device_org_allocation_log", schema="agripump")
    op.drop_index("idx_doal_from_org", "device_org_allocation_log", schema="agripump")
    op.drop_index("idx_doal_to_org", "device_org_allocation_log", schema="agripump")
    op.drop_index("idx_doal_occurred_at", "device_org_allocation_log", schema="agripump")
    op.drop_index("idx_doal_device_id", "device_org_allocation_log", schema="agripump")
    op.drop_table("device_org_allocation_log", schema="agripump")
    op.drop_index("idx_pbh_device_id", "panel_binding_history", schema="agripump")
    op.drop_table("panel_binding_history", schema="agripump")
    op.execute("DROP INDEX CONCURRENTLY IF EXISTS agripump.idx_pumps_org_lifecycle")
    op.execute("DROP INDEX CONCURRENTLY IF EXISTS agripump.idx_pumps_serial_search")
'''

for path, content in files.items():
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"WRITTEN: {os.path.relpath(path, BASE)}")

print("Part 1 done.")
