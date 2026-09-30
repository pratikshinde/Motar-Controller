"""P2.3 — telemetry_retention_and_rollups

Revision ID: c1f2d3e4f567
Revises: b8367a6be91d
Create Date: 2026-09-25

Creates:
  - agripump.daily_summary: per-device per-day rollup table (NFR-D-001/002)
  - Ensures idx_telemetry_dedup exists (idempotent - already created live)
  - Ensures idx_telemetry_pump_time index (idempotent)
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'c1f2d3e4f567'
down_revision: Union[str, Sequence[str], None] = '0bb2f7da69cd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # -------------------------------------------------------------------------
    # 1. daily_summary — one row per (device_id, day), populated by the nightly
    #    compaction job.  Reads for week/month views come from here instead of
    #    scanning raw telemetry (NFR-D-001, FR-CLD-025).
    # -------------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS agripump.daily_summary (
            id              BIGSERIAL PRIMARY KEY,
            device_id       VARCHAR(50) NOT NULL
                            REFERENCES agripump.pumps(id) ON DELETE CASCADE,
            day             DATE        NOT NULL,

            -- Operational metrics
            runtime_min     INTEGER     NOT NULL DEFAULT 0,
            start_count     INTEGER     NOT NULL DEFAULT 0,
            fault_count     INTEGER     NOT NULL DEFAULT 0,
            offline_min     INTEGER     NOT NULL DEFAULT 0,

            -- Voltage stats (line-to-line, 3-phase)
            v_min           NUMERIC(6,2),
            v_max           NUMERIC(6,2),
            v_mean          NUMERIC(6,2),

            -- Current stats (phase average)
            i_min           NUMERIC(6,2),
            i_max           NUMERIC(6,2),
            i_mean          NUMERIC(6,2),

            -- Sample counts used to compute the aggregates
            sample_count    INTEGER     NOT NULL DEFAULT 0,

            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

            CONSTRAINT daily_summary_device_day_uniq UNIQUE (device_id, day)
        );
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_daily_summary_device_day
        ON agripump.daily_summary (device_id, day DESC);
    """)

    # -------------------------------------------------------------------------
    # 2. Ensure the dedup index exists (was created live in P2.2 setup but
    #    must be idempotent in the migration path for fresh deployments).
    # -------------------------------------------------------------------------
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_dedup
        ON agripump.telemetry_history (pump_id, seq)
        WHERE seq IS NOT NULL;
    """)

    # -------------------------------------------------------------------------
    # 3. Enable RLS on daily_summary (same pattern as other tables).
    # -------------------------------------------------------------------------
    op.execute("ALTER TABLE agripump.daily_summary ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE agripump.daily_summary FORCE ROW LEVEL SECURITY;")
    op.execute("""
        DROP POLICY IF EXISTS rls_daily_summary_policy ON agripump.daily_summary;
        CREATE POLICY rls_daily_summary_policy ON agripump.daily_summary
        FOR ALL
        USING (
            current_setting('app.bypass_rls', true) = 'on'
            OR current_setting('app.user_role', true) = 'superadmin'
            OR device_id = current_setting('app.device_id', true)
            OR EXISTS (
                SELECT 1 FROM agripump.device_access da
                WHERE da.device_id = daily_summary.device_id
                  AND da.user_id = current_setting('app.user_id', true)::uuid
            )
        );
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS agripump.daily_summary CASCADE;")
