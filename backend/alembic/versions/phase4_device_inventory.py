"""device inventory: org allocation log, panel binding history, prefix search on pump ids

Revision ID: phase4_device_inventory
Revises: phase3_dashboard_indexes

Creates `device_org_allocation_log` and `panel_binding_history`, and an index for searching pumps by the start of
their id. Not repeated here, because they already exist: the unique index on pumps.id (it is the primary key) and the
(org_id, lifecycle_state) index (`ix_pumps_org_state`, phase3_dashboard_indexes).

Note: neither new table has row-level security yet. Nothing mounts the Phase 4 services today; add the policies (the
pattern is `dashboard_runtime` in phase3_dashboard_indexes) before a route can read or write them.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "phase4_device_inventory"
down_revision = "phase3_dashboard_indexes"
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

    # ── Prefix search on pump ids ───────────────────────────────────────────
    # CONCURRENTLY cannot run inside the migration's transaction (see phase3_dashboard_indexes).
    with op.get_context().autocommit_block():
        op.execute("""
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pumps_serial_search
            ON agripump.pumps (id varchar_pattern_ops)
        """)


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS agripump.idx_pumps_serial_search")
    op.drop_index("idx_pbh_device_id", "panel_binding_history", schema="agripump")
    op.drop_table("panel_binding_history", schema="agripump")
    op.drop_index("idx_doal_idempotency", "device_org_allocation_log", schema="agripump")
    op.drop_index("idx_doal_from_org", "device_org_allocation_log", schema="agripump")
    op.drop_index("idx_doal_to_org", "device_org_allocation_log", schema="agripump")
    op.drop_index("idx_doal_occurred_at", "device_org_allocation_log", schema="agripump")
    op.drop_index("idx_doal_device_id", "device_org_allocation_log", schema="agripump")
    op.drop_table("device_org_allocation_log", schema="agripump")
