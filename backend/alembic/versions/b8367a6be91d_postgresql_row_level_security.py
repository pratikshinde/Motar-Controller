"""postgresql_row_level_security

Revision ID: b8367a6be91d
Revises: dedfed6ff030
Create Date: 2026-09-25 13:21:38.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'b8367a6be91d'
down_revision: Union[str, Sequence[str], None] = 'dedfed6ff030'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Enable RLS on agripump.pumps
    op.execute("ALTER TABLE agripump.pumps ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE agripump.pumps FORCE ROW LEVEL SECURITY;")
    op.execute("""
    DROP POLICY IF EXISTS rls_pumps_policy ON agripump.pumps;
    CREATE POLICY rls_pumps_policy ON agripump.pumps
    FOR ALL
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR current_setting('app.user_role', true) = 'superadmin'
        OR current_setting('app.device_id', true) = id
        OR (
            current_setting('app.user_role', true) = 'customer'
            AND (
                owner_user_id::text = current_setting('app.user_id', true)
                OR id IN (
                    SELECT device_id FROM agripump.device_access
                    WHERE user_id::text = current_setting('app.user_id', true)
                )
            )
        )
        OR (
            current_setting('app.user_role', true) IN ('dealer', 'distributor', 'manufacturer')
            AND (
                (
                    current_setting('app.org_path', true) IS NOT NULL
                    AND org_id IN (
                        SELECT id FROM agripump.organisations
                        WHERE path OPERATOR(agripump.<@) current_setting('app.org_path', true)::agripump.ltree
                    )
                )
                OR (
                    current_setting('app.hierarchy_path', true) IS NOT NULL
                    AND hierarchy_path LIKE current_setting('app.hierarchy_path', true) || '%'
                )
            )
        )
    );
    """)

    # 2. Enable RLS on agripump.device_access
    op.execute("ALTER TABLE agripump.device_access ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE agripump.device_access FORCE ROW LEVEL SECURITY;")
    op.execute("""
    DROP POLICY IF EXISTS rls_device_access_policy ON agripump.device_access;
    CREATE POLICY rls_device_access_policy ON agripump.device_access
    FOR ALL
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR current_setting('app.user_role', true) = 'superadmin'
        OR user_id::text = current_setting('app.user_id', true)
    );
    """)

    # 3. Enable RLS on agripump.telemetry_history
    op.execute("ALTER TABLE agripump.telemetry_history ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE agripump.telemetry_history FORCE ROW LEVEL SECURITY;")
    op.execute("""
    DROP POLICY IF EXISTS rls_telemetry_policy ON agripump.telemetry_history;
    CREATE POLICY rls_telemetry_policy ON agripump.telemetry_history
    FOR ALL
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR current_setting('app.user_role', true) = 'superadmin'
        OR current_setting('app.device_id', true) = pump_id
        OR pump_id IN (
            SELECT id FROM agripump.pumps
        )
    );
    """)

    # 4. Enable RLS on agripump.commands
    op.execute("ALTER TABLE agripump.commands ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE agripump.commands FORCE ROW LEVEL SECURITY;")
    op.execute("""
    DROP POLICY IF EXISTS rls_commands_policy ON agripump.commands;
    CREATE POLICY rls_commands_policy ON agripump.commands
    FOR ALL
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR current_setting('app.user_role', true) = 'superadmin'
        OR current_setting('app.device_id', true) = pump_id
        OR pump_id IN (
            SELECT id FROM agripump.pumps
        )
    );
    """)

    # 5. Enable RLS on agripump.device_config
    op.execute("ALTER TABLE agripump.device_config ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE agripump.device_config FORCE ROW LEVEL SECURITY;")
    op.execute("""
    DROP POLICY IF EXISTS rls_device_config_policy ON agripump.device_config;
    CREATE POLICY rls_device_config_policy ON agripump.device_config
    FOR ALL
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR current_setting('app.user_role', true) = 'superadmin'
        OR current_setting('app.device_id', true) = pump_id
        OR pump_id IN (
            SELECT id FROM agripump.pumps
        )
    );
    """)

    # 6. Enable RLS on agripump.fault_logs
    op.execute("ALTER TABLE agripump.fault_logs ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE agripump.fault_logs FORCE ROW LEVEL SECURITY;")
    op.execute("""
    DROP POLICY IF EXISTS rls_fault_logs_policy ON agripump.fault_logs;
    CREATE POLICY rls_fault_logs_policy ON agripump.fault_logs
    FOR ALL
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR current_setting('app.user_role', true) = 'superadmin'
        OR current_setting('app.device_id', true) = pump_id
        OR pump_id IN (
            SELECT id FROM agripump.pumps
        )
    );
    """)

    # 7. Enable RLS on agripump.alerts
    op.execute("ALTER TABLE agripump.alerts ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE agripump.alerts FORCE ROW LEVEL SECURITY;")
    op.execute("""
    DROP POLICY IF EXISTS rls_alerts_policy ON agripump.alerts;
    CREATE POLICY rls_alerts_policy ON agripump.alerts
    FOR ALL
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR current_setting('app.user_role', true) = 'superadmin'
        OR current_setting('app.device_id', true) = pump_id
        OR pump_id IN (
            SELECT id FROM agripump.pumps
        )
    );
    """)

    # 8. Enable RLS on agripump.audit_log
    op.execute("ALTER TABLE agripump.audit_log ENABLE ROW LEVEL SECURITY;")
    op.execute("ALTER TABLE agripump.audit_log FORCE ROW LEVEL SECURITY;")
    op.execute("""
    DROP POLICY IF EXISTS rls_audit_log_policy ON agripump.audit_log;
    CREATE POLICY rls_audit_log_policy ON agripump.audit_log
    FOR ALL
    USING (
        current_setting('app.bypass_rls', true) = 'on'
        OR current_setting('app.user_role', true) = 'superadmin'
        OR actor_id::text = current_setting('app.user_id', true)
        OR (
            entity_type = 'pump' AND entity_id IN (SELECT id FROM agripump.pumps)
        )
    );
    """)

    # 9. Enforce append-only immutability for audit_log (FR-CLD-062)
    op.execute("""
    CREATE OR REPLACE FUNCTION agripump.fn_prevent_audit_tampering()
    RETURNS TRIGGER AS $$
    BEGIN
        RAISE EXCEPTION 'audit_log is append-only: updates and deletes are strictly prohibited';
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_audit_log_immutable ON agripump.audit_log;
    CREATE TRIGGER trg_audit_log_immutable
    BEFORE UPDATE OR DELETE ON agripump.audit_log
    FOR EACH ROW EXECUTE FUNCTION agripump.fn_prevent_audit_tampering();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_audit_log_immutable ON agripump.audit_log;")
    op.execute("DROP FUNCTION IF EXISTS agripump.fn_prevent_audit_tampering();")

    tables = ["audit_log", "alerts", "fault_logs", "device_config", "commands", "telemetry_history", "device_access", "pumps"]
    for t in tables:
        op.execute(f"DROP POLICY IF EXISTS rls_{t}_policy ON agripump.{t};")
        op.execute(f"ALTER TABLE agripump.{t} NO FORCE ROW LEVEL SECURITY;")
        op.execute(f"ALTER TABLE agripump.{t} DISABLE ROW LEVEL SECURITY;")
