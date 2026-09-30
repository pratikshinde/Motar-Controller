"""Phase 2C: Add organisation invitation columns to invite_tokens

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-09-30
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = "agripump"

def upgrade() -> None:
    # 1. Add columns to invite_tokens
    op.add_column("invite_tokens", sa.Column("phone", sa.String(length=20), nullable=True), schema=SCHEMA)
    op.add_column("invite_tokens", sa.Column("target_role", sa.String(length=30), nullable=True), schema=SCHEMA)
    op.add_column(
        "invite_tokens",
        sa.Column(
            "target_org_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey(f"{SCHEMA}.organisations.id", ondelete="CASCADE"),
            nullable=True
        ),
        schema=SCHEMA
    )
    op.add_column(
        "invite_tokens",
        sa.Column("status", sa.String(length=20), nullable=False, server_default="PENDING"),
        schema=SCHEMA
    )
    op.add_column("invite_tokens", sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True), schema=SCHEMA)

    # 2. Add indexes
    op.create_index("ix_invite_tokens_phone", "invite_tokens", ["phone"], schema=SCHEMA)
    op.create_index("ix_invite_tokens_target_org_id", "invite_tokens", ["target_org_id"], schema=SCHEMA)
    op.create_index("ix_invite_tokens_status", "invite_tokens", ["status"], schema=SCHEMA)

    # 3. Backfill status for existing redeemed rows if any
    op.execute(f"UPDATE {SCHEMA}.invite_tokens SET status = 'ACCEPTED' WHERE used_at IS NOT NULL")


def downgrade() -> None:
    op.drop_index("ix_invite_tokens_status", table_name="invite_tokens", schema=SCHEMA)
    op.drop_index("ix_invite_tokens_target_org_id", table_name="invite_tokens", schema=SCHEMA)
    op.drop_index("ix_invite_tokens_phone", table_name="invite_tokens", schema=SCHEMA)

    op.drop_column("invite_tokens", "accepted_at", schema=SCHEMA)
    op.drop_column("invite_tokens", "status", schema=SCHEMA)
    op.drop_column("invite_tokens", "target_org_id", schema=SCHEMA)
    op.drop_column("invite_tokens", "target_role", schema=SCHEMA)
    op.drop_column("invite_tokens", "phone", schema=SCHEMA)
