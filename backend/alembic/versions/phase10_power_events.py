"""power events: when the power came and when it went, per pump

Revision ID: phase10_power_events
Revises: phase9_pump_schedules

What the farmer is told by notification is exactly this: the power came, or the power went. Each pump keeps its current state
(`power_state` ON / OFF, since `power_changed_at`, and what told us: `power_source` VOLTAGE = the starter reported no line voltage, or
CONTACT = it stopped reporting at all), and every change is one row in `pump_power_events` (the history behind the Home banner and the
admin dashboard). Everything else (faults, offline, and so on) stays in the Alerts list and is never pushed.
"""
from alembic import op

revision = "phase10_power_events"
down_revision = "phase9_pump_schedules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")
    op.execute("ALTER TABLE agripump.pumps ADD COLUMN IF NOT EXISTS power_state varchar(3)")
    op.execute("ALTER TABLE agripump.pumps ADD COLUMN IF NOT EXISTS power_changed_at timestamptz")
    op.execute("ALTER TABLE agripump.pumps ADD COLUMN IF NOT EXISTS power_source varchar(10)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS agripump.pump_power_events (
            id           uuid PRIMARY KEY,
            pump_id      varchar(50) NOT NULL REFERENCES agripump.pumps(id) ON DELETE CASCADE ON UPDATE CASCADE,
            state        varchar(3) NOT NULL,
            source       varchar(10) NOT NULL,
            occurred_at  timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT ck_power_events_state CHECK (state IN ('ON', 'OFF')),
            CONSTRAINT ck_power_events_source CHECK (source IN ('VOLTAGE', 'CONTACT'))
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_power_events_pump ON agripump.pump_power_events (pump_id, occurred_at DESC)")
    op.execute("ALTER TABLE agripump.pump_power_events ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE agripump.pump_power_events FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS rls_pump_power_events_policy ON agripump.pump_power_events")
    op.execute("""
        CREATE POLICY rls_pump_power_events_policy ON agripump.pump_power_events
        FOR ALL
        USING (
            current_setting('app.bypass_rls', true) = 'on'
            OR current_setting('app.user_role', true) = 'superadmin'
            OR pump_id IN (SELECT id FROM agripump.pumps)
        )
    """)


def downgrade() -> None:
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")
    op.execute("DROP TABLE IF EXISTS agripump.pump_power_events")
    op.execute("ALTER TABLE agripump.pumps DROP COLUMN IF EXISTS power_source")
    op.execute("ALTER TABLE agripump.pumps DROP COLUMN IF EXISTS power_changed_at")
    op.execute("ALTER TABLE agripump.pumps DROP COLUMN IF EXISTS power_state")
