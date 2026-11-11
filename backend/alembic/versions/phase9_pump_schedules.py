"""weekly pump schedule: the days and hours a pump switches on and off by itself

Revision ID: phase9_pump_schedules
Revises: phase8_farmer_claims

The controller has no clock, so the cloud keeps the calendar and sends START and STOP at the set times
(`app/services/schedule_service.py`). Three tables:

  pump_schedules         one row per pump: on / off, and the time zone the times are in
  pump_schedule_entries  one row per "on at 06:00, off at 09:00" on one weekday
  pump_schedule_runs     one row per START or STOP that came due, with what happened to it (also the "what happened lately" list)

Row-level security follows the pump: a person sees the schedule of the pumps they can see; the background runner bypasses it.
"""
from alembic import op

revision = "phase9_pump_schedules"
down_revision = "phase8_farmer_claims"
branch_labels = None
depends_on = None

_POLICY = """
    CREATE POLICY {name} ON agripump.{table}
    FOR ALL
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR current_setting('app.user_role', true) = 'superadmin'
        OR pump_id IN (SELECT id FROM agripump.pumps)
    )
"""


def upgrade() -> None:
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS agripump.pump_schedules (
            pump_id     varchar(50) PRIMARY KEY REFERENCES agripump.pumps(id) ON DELETE CASCADE ON UPDATE CASCADE,
            enabled     boolean NOT NULL DEFAULT false,
            timezone    varchar(50) NOT NULL DEFAULT 'Asia/Kolkata',
            updated_by  uuid REFERENCES agripump.users(id) ON DELETE SET NULL,
            updated_at  timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS agripump.pump_schedule_entries (
            id           uuid PRIMARY KEY,
            pump_id      varchar(50) NOT NULL REFERENCES agripump.pumps(id) ON DELETE CASCADE ON UPDATE CASCADE,
            day_of_week  smallint NOT NULL,
            on_time      varchar(5) NOT NULL,
            off_time     varchar(5) NOT NULL,
            enabled      boolean NOT NULL DEFAULT true,
            CONSTRAINT ck_schedule_entries_day CHECK (day_of_week BETWEEN 0 AND 6)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_schedule_entries_pump ON agripump.pump_schedule_entries (pump_id)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS agripump.pump_schedule_runs (
            id           uuid PRIMARY KEY,
            pump_id      varchar(50) NOT NULL REFERENCES agripump.pumps(id) ON DELETE CASCADE ON UPDATE CASCADE,
            kind         varchar(5) NOT NULL,
            due_at       timestamptz NOT NULL,
            day_of_week  smallint NOT NULL,
            local_time   varchar(5) NOT NULL,
            outcome      varchar(20) NOT NULL DEFAULT 'PENDING',
            detail       text,
            command_cid  uuid REFERENCES agripump.commands(cid) ON DELETE SET NULL,
            created_at   timestamptz NOT NULL DEFAULT now(),
            updated_at   timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT ck_schedule_runs_kind CHECK (kind IN ('START', 'STOP')),
            CONSTRAINT uq_schedule_runs_due UNIQUE (pump_id, kind, due_at)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_schedule_runs_pending ON agripump.pump_schedule_runs (due_at) WHERE outcome = 'PENDING'")
    op.execute("CREATE INDEX IF NOT EXISTS ix_schedule_runs_recent ON agripump.pump_schedule_runs (pump_id, due_at DESC)")
    for table in ("pump_schedules", "pump_schedule_entries", "pump_schedule_runs"):
        op.execute(f"ALTER TABLE agripump.{table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE agripump.{table} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS rls_{table}_policy ON agripump.{table}")
        op.execute(_POLICY.format(name=f"rls_{table}_policy", table=table))


def downgrade() -> None:
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")
    op.execute("DROP TABLE IF EXISTS agripump.pump_schedule_runs")
    op.execute("DROP TABLE IF EXISTS agripump.pump_schedule_entries")
    op.execute("DROP TABLE IF EXISTS agripump.pump_schedules")
