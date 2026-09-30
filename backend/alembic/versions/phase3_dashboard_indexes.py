"""dashboards: let partners read the daily rollups, and index what the dashboard queries filter on

Revision ID: phase3_dashboard_indexes
Revises: c3d4e5f6a7b8

1. `daily_summary` had a row-level-security policy for the super admin, the device itself and farmers (through
   device_access) but none for partners, so a dealer/distributor/manufacturer's runtime history read back as zero no
   matter how the query was written. A SELECT-only policy now admits exactly the rows of devices the caller can already
   see (`pumps` is itself under RLS). Read-only: partners still cannot write rollups.

2. Indexes, chosen from EXPLAIN ANALYZE on a 100,000-device / 1M-fault / 3M-rollup dataset
   (scripts/bench_dashboard.py, results in scripts/bench_results/). Deliberately NOT indexed: pumps.last_seen_at, which
   ingest rewrites on every telemetry frame (an index on it would stop those updates being cheap in-place ones).
   The indexes that already exist on these tables (pumps.hierarchy_path with text_pattern_ops, fault_logs(pump_id,
   occurred_at), daily_summary(device_id, day)) are not repeated.

3. `dashboard_runtime`: one row per device holding the minutes its motor has run today and over the recent completed
   days of the dashboard window, refreshed every few minutes by the dashboard refresher
   (app/services/dashboard_rollup_service.py). The nightly rollup only holds finished days, and summing them (and
   counting today from raw telemetry) on every dashboard refresh cost 1-3 s for a large partner at 100,000 devices;
   with this every scope's runtime is one sum over a narrow table. Same access rules as `daily_summary`: the server
   (bypass) and super admin can write; anyone can read the rows of devices they can see. The foreign key follows a
   device's id when a bridge swap renames it.

Built CONCURRENTLY, outside the migration's transaction, so a large production table is not write-locked while they
build. TimescaleDB hypertables already carry a time index and cannot build one concurrently, so that one is skipped there.
"""
from alembic import op

revision = "phase3_dashboard_indexes"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None

# name -> DDL. Also read by scripts/bench_dashboard.py so the benchmark and the migration cannot drift apart.
INDEXES = {
    # Partner scope: `org_id = ANY(subtree)` (was a full scan of pumps for every dashboard query).
    "ix_pumps_org_state":
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_pumps_org_state ON agripump.pumps (org_id, lifecycle_state)",
    # "Faults today" and the top-faulting window: range-scan recent faults instead of probing every pump.
    "ix_fault_logs_time":
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_fault_logs_time ON agripump.fault_logs (occurred_at DESC) "
        "INCLUDE (pump_id) WHERE fault_code > 0",
    # Completed days of runtime: index-only range scan over the window.
    "ix_daily_summary_day":
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_daily_summary_day ON agripump.daily_summary (day) "
        "INCLUDE (device_id, runtime_min)",
}
# Today's live runtime reads only today's telemetry; without a time index it scans the whole retention window.
TELEMETRY_TIME_INDEX = (
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_telemetry_time ON agripump.telemetry_history "
    "(recorded_at DESC) INCLUDE (pump_id, pump_on)"
)

PARTNER_READ_POLICY = "rls_daily_summary_partner_read"
RUNTIME_POLICIES = ("rls_dashboard_runtime_policy", "rls_dashboard_runtime_read")


def _is_hypertable(bind) -> bool:
    from sqlalchemy import text
    try:
        return bool(bind.execute(text(
            "SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'")).first()) and bool(bind.execute(text(
            "SELECT 1 FROM timescaledb_information.hypertables "
            "WHERE hypertable_schema = 'agripump' AND hypertable_name = 'telemetry_history'")).first())
    except Exception:
        return False


def upgrade() -> None:
    op.execute(f"DROP POLICY IF EXISTS {PARTNER_READ_POLICY} ON agripump.daily_summary")
    op.execute(
        f"CREATE POLICY {PARTNER_READ_POLICY} ON agripump.daily_summary FOR SELECT "
        f"USING (device_id IN (SELECT id FROM agripump.pumps))"
    )

    op.execute(
        "CREATE TABLE IF NOT EXISTS agripump.dashboard_runtime ("
        "device_id VARCHAR(50) PRIMARY KEY REFERENCES agripump.pumps(id) ON DELETE CASCADE ON UPDATE CASCADE, "
        "day DATE NOT NULL, "
        "runtime_min INTEGER NOT NULL DEFAULT 0, "      # minutes run today (the day above)
        "history_min INTEGER NOT NULL DEFAULT 0, "      # minutes run over the completed days before today
        "history_days SMALLINT NOT NULL DEFAULT 0, "    # the window these figures were computed for (today + N-1 days)
        "updated_at TIMESTAMPTZ NOT NULL DEFAULT now())"
    )
    op.execute("ALTER TABLE agripump.dashboard_runtime ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE agripump.dashboard_runtime FORCE ROW LEVEL SECURITY")
    for name in RUNTIME_POLICIES:
        op.execute(f"DROP POLICY IF EXISTS {name} ON agripump.dashboard_runtime")
    op.execute(
        "CREATE POLICY rls_dashboard_runtime_policy ON agripump.dashboard_runtime FOR ALL USING ("
        "current_setting('app.bypass_rls', true) = 'on' OR current_setting('app.user_role', true) = 'superadmin')"
    )
    op.execute(
        "CREATE POLICY rls_dashboard_runtime_read ON agripump.dashboard_runtime FOR SELECT "
        "USING (device_id IN (SELECT id FROM agripump.pumps))"
    )

    hypertable = _is_hypertable(op.get_bind())
    with op.get_context().autocommit_block():
        for ddl in INDEXES.values():
            op.execute(ddl)
        if not hypertable:
            op.execute(TELEMETRY_TIME_INDEX)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS agripump.dashboard_runtime")
    op.execute(f"DROP POLICY IF EXISTS {PARTNER_READ_POLICY} ON agripump.daily_summary")
    with op.get_context().autocommit_block():
        for name in (*INDEXES, "ix_telemetry_time"):
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS agripump.{name}")
