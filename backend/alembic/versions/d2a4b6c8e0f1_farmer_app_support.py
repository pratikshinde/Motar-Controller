"""Farmer-app support: cumulative run time, subscription expiry, account-deletion requests

Revision ID: d2a4b6c8e0f1
Revises: c1f2d3e4f567
Create Date: 2026-09-26

Adds (all additive, nullable / defaulted, safe on a live database):
  - agripump.pumps.total_runtime_min       cumulative run time reported by the device (`rt`)
  - agripump.pumps.subscription_expires_at plan expiry, shown to the farmer 7 days before it lapses
  - agripump.account_deletion_requests     "delete my data" requests, handled by staff (DPDP Act)
"""
from typing import Sequence, Union
from alembic import op

revision: str = 'd2a4b6c8e0f1'
down_revision: Union[str, Sequence[str], None] = 'c1f2d3e4f567'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE agripump.pumps ADD COLUMN IF NOT EXISTS total_runtime_min BIGINT")
    op.execute("ALTER TABLE agripump.pumps ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ")

    op.execute("""
        CREATE TABLE IF NOT EXISTS agripump.account_deletion_requests (
            id           BIGSERIAL PRIMARY KEY,
            user_id      UUID        NOT NULL REFERENCES agripump.users(id) ON DELETE CASCADE,
            requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            status       VARCHAR(20) NOT NULL DEFAULT 'PENDING',
            reason       TEXT,
            handled_at   TIMESTAMPTZ,
            handled_by   UUID
        )
    """)
    # At most one open request per user, so a double tap cannot create duplicates.
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_account_deletion_pending
        ON agripump.account_deletion_requests (user_id) WHERE status = 'PENDING'
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS agripump.uq_account_deletion_pending")
    op.execute("DROP TABLE IF EXISTS agripump.account_deletion_requests")
    op.execute("ALTER TABLE agripump.pumps DROP COLUMN IF EXISTS subscription_expires_at")
    op.execute("ALTER TABLE agripump.pumps DROP COLUMN IF EXISTS total_runtime_min")
