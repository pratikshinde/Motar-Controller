"""one schema: bring Alembic-built and schema.sql-built databases to the same shape

Revision ID: e6a8c0d2f4b6
Revises: d4f6b8a0c2e4
Create Date: 2026-09-28

Until now a database was created one of three ways (schema.sql, `Base.metadata.create_all`, Alembic) and the Alembic
baseline could not even run on an empty database. Building one from the migrations alone gave a schema that was much
weaker than the one the application had been running on: no unique phone number, no alert de-duplication index, no
role / status CHECKs, several missing ON DELETE rules, no performance indexes and no fault-code reference data.

This migration is the reconciliation. It is written to be applied to either kind of database:

* what a database already has is left alone (checks by name / by effect, IF NOT EXISTS);
* what would break existing data is NOT forced: a NOT NULL, CHECK or UNIQUE that the current rows violate is skipped
  with a WARNING (and the CHECK is still added NOT VALID so new rows are held to it). `scripts/schema_diff.py`
  shows what was skipped;
* nothing is dropped except defaults that invented data (see below).

Decisions that change behaviour:

* server defaults on uuid primary keys use `gen_random_uuid()` (built in), so the `uuid-ossp` extension is no longer
  needed;
* `telemetry_history.gsm_rssi` no longer defaults to 24 and `pumps.hp_rating` no longer defaults to 7.5: a missing
  reading is NULL, not a plausible number; `fault_code_catalog.code` loses its sequence (codes are the firmware's, set
  explicitly); `commands.status` defaults to QUEUED (P2.4);
* tables the portal's features need (`invite_tokens`, `bridge_swap_log`, `mcu_swap_log`) exist in every database;
* the ten fault codes of SRS §6.2 are seeded (existing rows are not overwritten).

Not reversible (downgrade does nothing): going back would re-open the gaps this closes.
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'e6a8c0d2f4b6'
down_revision: Union[str, Sequence[str], None] = 'd4f6b8a0c2e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "agripump"


def do(body: str, declare: str = "") -> None:
    decl = f"DECLARE\n{declare}\n" if declare else ""
    op.execute(f"DO $mig$\n{decl}BEGIN\n{body}\nEND\n$mig$;")


# ---------------------------------------------------------------------------------------------------------------------
# helpers: each one is safe to run on a database that already has the thing
# ---------------------------------------------------------------------------------------------------------------------
def _column_guard(table: str, column: str, statement: str, note: str) -> None:
    """Run `statement` only if the column exists; a database that lacks it has nothing to fix."""
    do(f"""
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = '{S}' AND table_name = '{table}' AND column_name = '{column}') THEN
        {statement}
    ELSE
        RAISE NOTICE 'schema: {table}.{column} does not exist here, {note} skipped';
    END IF;""")


def set_default(table: str, column: str, expr: str) -> None:
    _column_guard(table, column, f"ALTER TABLE {S}.{table} ALTER COLUMN {column} SET DEFAULT {expr};", "default")


def drop_default(table: str, column: str) -> None:
    _column_guard(table, column, f"ALTER TABLE {S}.{table} ALTER COLUMN {column} DROP DEFAULT;", "drop default")


def set_not_null(table: str, column: str, backfill: str = "") -> None:
    fill = f"UPDATE {S}.{table} SET {column} = {backfill} WHERE {column} IS NULL;" if backfill else ""
    _column_guard(table, column, f"""
        {fill}
        IF EXISTS (SELECT 1 FROM {S}.{table} WHERE {column} IS NULL) THEN
            RAISE WARNING 'schema: {table}.{column} left nullable, it holds NULL values';
        ELSE
            ALTER TABLE {S}.{table} ALTER COLUMN {column} SET NOT NULL;
        END IF;""", "NOT NULL")


def add_check(table: str, name: str, expr: str) -> None:
    do(f"""
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '{name}' AND conrelid = '{S}.{table}'::regclass) THEN
        ALTER TABLE {S}.{table} ADD CONSTRAINT {name} CHECK ({expr}) NOT VALID;
        BEGIN
            ALTER TABLE {S}.{table} VALIDATE CONSTRAINT {name};
        EXCEPTION WHEN check_violation THEN
            RAISE WARNING 'schema: {name} added NOT VALID, existing rows of {table} break it';
        END;
    END IF;""")


def set_fk(table: str, column: str, ref_table: str, on_delete: str, name: str, ref_column: str = "id",
           on_update: bool = True) -> None:
    """Make the foreign key on table.column behave as given. Only touches it if its rules differ (re-adding a key
    validates every row, which on telemetry_history is not something to do for nothing)."""
    del_flag = {"CASCADE": "c", "SET NULL": "n", "NO ACTION": "a", "RESTRICT": "r"}[on_delete]
    upd_flag = "c" if on_update else "a"
    upd_sql = " ON UPDATE CASCADE" if on_update else ""
    do(f"""
    FOR r IN SELECT conname, confdeltype, confupdtype FROM pg_constraint
             WHERE conrelid = '{S}.{table}'::regclass AND contype = 'f' AND conkey = ARRAY[col_no]
    LOOP
        IF r.confdeltype = '{del_flag}' AND r.confupdtype = '{upd_flag}' THEN
            ok := true;
        ELSE
            EXECUTE format('ALTER TABLE {S}.{table} DROP CONSTRAINT %I', r.conname);
        END IF;
    END LOOP;
    IF NOT ok THEN
        ALTER TABLE {S}.{table} ADD CONSTRAINT {name}
            FOREIGN KEY ({column}) REFERENCES {S}.{ref_table}({ref_column}) ON DELETE {on_delete}{upd_sql};
    END IF;""", declare=f"""
    col_no smallint := (SELECT attnum FROM pg_attribute WHERE attrelid = '{S}.{table}'::regclass AND attname = '{column}');
    r record;
    ok boolean := false;""")


def add_index(name: str, table: str, definition: str, unique: bool = False) -> None:
    kind = "UNIQUE INDEX" if unique else "INDEX"
    if unique:
        do(f"""
        BEGIN
            CREATE {kind} IF NOT EXISTS {name} ON {S}.{table} {definition};
        EXCEPTION WHEN unique_violation THEN
            RAISE WARNING 'schema: unique index {name} not created, {table} holds duplicates';
        END;""")
    else:
        op.execute(f"CREATE {kind} IF NOT EXISTS {name} ON {S}.{table} {definition}")


def unique_on(table: str, column: str, name: str) -> None:
    """A UNIQUE constraint on one column, unless some unique index already covers exactly that column."""
    do(f"""
    IF NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = '{S}.{table}'::regclass AND i.indisunique AND i.indnatts = 1 AND i.indpred IS NULL
          AND i.indkey[0] = (SELECT attnum FROM pg_attribute WHERE attrelid = '{S}.{table}'::regclass AND attname = '{column}')
    ) THEN
        BEGIN
            ALTER TABLE {S}.{table} ADD CONSTRAINT {name} UNIQUE ({column});
        EXCEPTION WHEN unique_violation THEN
            RAISE WARNING 'schema: {table}.{column} is not unique yet, it holds duplicates';
        END;
    END IF;""")


def widen(table: str, column: str, type_sql: str, max_len: int) -> None:
    """Change a varchar length only if every current value fits in the new one."""
    _column_guard(table, column, f"""
        IF (SELECT coalesce(max(length({column})), 0) FROM {S}.{table}) <= {max_len} THEN
            ALTER TABLE {S}.{table} ALTER COLUMN {column} TYPE {type_sql};
        ELSE
            RAISE WARNING 'schema: {table}.{column} not resized, a value is longer than {max_len}';
        END IF;""", "resize")


# ---------------------------------------------------------------------------------------------------------------------
def upgrade() -> None:
    # `pumps`, `commands` ... have FORCE row-level security: without this the data checks below would see no rows.
    op.execute("SELECT set_config('app.bypass_rls', 'on', true)")

    # ---- tables the portal's features need (bridge / controller swaps, onboarding invites)
    op.execute(f"""
    CREATE TABLE IF NOT EXISTS {S}.invite_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        token_hash VARCHAR(255) UNIQUE NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('manufacturer', 'distributor', 'dealer', 'customer')),
        parent_user_id UUID NOT NULL REFERENCES {S}.users(id) ON DELETE CASCADE,
        parent_hierarchy_path TEXT NOT NULL,
        created_by UUID REFERENCES {S}.users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        used_by_user_id UUID REFERENCES {S}.users(id) ON DELETE SET NULL
    )""")
    op.execute(f"CREATE INDEX IF NOT EXISTS idx_invite_tokens_parent ON {S}.invite_tokens (parent_user_id, created_at DESC)")
    op.execute(f"""
    CREATE TABLE IF NOT EXISTS {S}.bridge_swap_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        old_pump_id VARCHAR(50) NOT NULL,
        new_pump_id VARCHAR(50) NOT NULL REFERENCES {S}.pumps(id) ON DELETE CASCADE ON UPDATE CASCADE,
        reason TEXT,
        performed_by UUID REFERENCES {S}.users(id) ON DELETE SET NULL,
        occurred_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )""")
    op.execute(f"CREATE INDEX IF NOT EXISTS idx_bridge_swap_log_new ON {S}.bridge_swap_log (new_pump_id, occurred_at DESC)")
    op.execute(f"""
    CREATE TABLE IF NOT EXISTS {S}.mcu_swap_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pump_id VARCHAR(50) NOT NULL REFERENCES {S}.pumps(id) ON DELETE CASCADE ON UPDATE CASCADE,
        old_mcu_uid VARCHAR(30),
        new_mcu_uid VARCHAR(30) NOT NULL,
        reason TEXT,
        performed_by UUID REFERENCES {S}.users(id) ON DELETE SET NULL,
        occurred_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )""")
    op.execute(f"CREATE INDEX IF NOT EXISTS idx_mcu_swap_log_pump ON {S}.mcu_swap_log (pump_id, occurred_at DESC)")

    # ---- columns the application reads and writes, which a database built from the original schema.sql never had
    # (they were added to running databases by hand). ADD COLUMN IF NOT EXISTS: a no-op wherever they exist.
    for table, column, ddl in [
        ("users", "phone", "VARCHAR(20)"),
        ("users", "phone_number", "VARCHAR(20)"),
        ("users", "account_status", "VARCHAR(10) NOT NULL DEFAULT 'ACTIVE'"),
        ("users", "dealer_depth", "SMALLINT NOT NULL DEFAULT 0"),
        ("users", "preferred_language", "VARCHAR(10) DEFAULT 'en'"),
        ("users", "org_role", "VARCHAR(10) DEFAULT 'owner'"),
        ("users", "contract_notes", "TEXT"),
        ("users", "device_quota", "INTEGER"),
        ("users", "parent_user_id", f"UUID REFERENCES {S}.users(id) ON DELETE SET NULL"),
        ("users", "org_node_id", f"UUID REFERENCES {S}.users(id) ON DELETE SET NULL"),
        ("fault_logs", "description", "TEXT"),
        ("fault_logs", "alert_sent_sms", "BOOLEAN DEFAULT false"),
        ("fault_logs", "alert_sent_whatsapp", "BOOLEAN DEFAULT false"),
        ("fault_logs", "contactor_tripped", "BOOLEAN DEFAULT true"),
        ("fault_logs", "v_yb_snapshot", "NUMERIC(5,1)"),
        ("users", "is_active", "BOOLEAN NOT NULL DEFAULT true"),
        ("users", "is_verified", "BOOLEAN NOT NULL DEFAULT false"),
        ("users", "updated_at", "TIMESTAMPTZ NOT NULL DEFAULT now()"),
        ("fault_logs", "v_ry", "NUMERIC(6,2)"), ("fault_logs", "v_yb", "NUMERIC(6,2)"), ("fault_logs", "v_br", "NUMERIC(6,2)"),
        ("fault_logs", "i_r", "NUMERIC(6,2)"), ("fault_logs", "i_y", "NUMERIC(6,2)"), ("fault_logs", "i_b", "NUMERIC(6,2)"),
        ("fault_logs", "fault_description", "TEXT"),
        ("fault_logs", "fault_code_legacy_text", "VARCHAR(30)"),
        ("config_templates", "config_json", "JSONB"),
        ("config_templates", "hp_rating", "NUMERIC(4,1)"),
        ("config_templates", "supply_type", "VARCHAR(20)"),
    ]:
        op.execute(f"ALTER TABLE {S}.{table} ADD COLUMN IF NOT EXISTS {column} {ddl}")
    # The two phone columns hold the same number. A database built from the original schema.sql only has phone_number,
    # one built by the first create_all only has phone: copy across so login (by `phone`) and lookups (by
    # `phone_number`) both find the account. Never at the price of a duplicate: a number already used by another
    # account in the target column is left alone, and of several accounts sharing one number only the oldest is copied.
    do(f"""
    BEGIN
        UPDATE {S}.users u SET phone = u.phone_number
        WHERE u.phone IS NULL AND u.phone_number IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM {S}.users o WHERE o.phone = u.phone_number)
          AND u.id = (SELECT x.id FROM {S}.users x WHERE x.phone_number = u.phone_number AND x.phone IS NULL
                      ORDER BY x.created_at NULLS LAST, x.id LIMIT 1);
        UPDATE {S}.users u SET phone_number = u.phone
        WHERE u.phone_number IS NULL AND u.phone IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM {S}.users o WHERE o.phone_number = u.phone)
          AND u.id = (SELECT x.id FROM {S}.users x WHERE x.phone = u.phone AND x.phone_number IS NULL
                      ORDER BY x.created_at NULLS LAST, x.id LIMIT 1);
    EXCEPTION WHEN unique_violation THEN
        RAISE WARNING 'schema: phone numbers were not copied between users.phone and users.phone_number, they conflict';
    END;""")
    # an account may have an email and no phone
    op.execute(f"ALTER TABLE {S}.users ALTER COLUMN phone_number DROP NOT NULL")

    # ---- column sizes the application already relies on
    widen("otp_challenges", "otp_code", "VARCHAR(64)", 64)       # stores a hash, not the 6 digits
    widen("users", "hierarchy_path", "TEXT", 1_000_000)           # a path can be longer than 255 characters
    widen("commands", "action", "VARCHAR(30)", 30)
    widen("fault_code_catalog", "name", "VARCHAR(50)", 50)
    widen("branding", "subdomain", "VARCHAR(63)", 63)          # a DNS label is up to 63 characters
    widen("branding", "theme_color", "VARCHAR(7)", 7)          # '#rrggbb'

    # ---- defaults
    # every single-column uuid primary key generates its own id
    do(f"""
    FOR r IN
        SELECT c.relname AS tbl, a.attname AS col
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = i.indkey[0]
        WHERE n.nspname = '{S}' AND i.indisprimary AND i.indnatts = 1 AND a.atttypid = 'uuid'::regtype AND c.relkind = 'r'
    LOOP
        EXECUTE format('ALTER TABLE {S}.%I ALTER COLUMN %I SET DEFAULT gen_random_uuid()', r.tbl, r.col);
    END LOOP;""", declare="r record;")

    defaults = [
        ("alert_subscriptions", "created_at", "CURRENT_TIMESTAMP"), ("alert_subscriptions", "muted", "false"),
        ("alerts", "first_occurred_at", "CURRENT_TIMESTAMP"), ("alerts", "last_occurred_at", "CURRENT_TIMESTAMP"),
        ("alerts", "occurrence_count", "1"),
        ("allocation_log", "occurred_at", "CURRENT_TIMESTAMP"), ("audit_log", "occurred_at", "CURRENT_TIMESTAMP"),
        ("batch_imeis", "claimed", "false"), ("batch_imeis", "created_at", "CURRENT_TIMESTAMP"),
        ("branding", "updated_at", "CURRENT_TIMESTAMP"),
        ("commands", "issued_at", "CURRENT_TIMESTAMP"), ("commands", "status", "'QUEUED'"),
        ("config_templates", "config_json", "'{}'::jsonb"), ("config_templates", "created_at", "CURRENT_TIMESTAMP"),
        ("config_templates", "supply_type", "'3-phase'"), ("config_templates", "updated_at", "CURRENT_TIMESTAMP"),
        ("device_batches", "created_at", "CURRENT_TIMESTAMP"), ("device_batches", "quantity", "0"),
        ("device_batches", "revoked", "false"),
        ("device_config", "desired_json", "'{}'::jsonb"), ("device_config", "reported_json", "'{}'::jsonb"),
        ("device_config", "status", "'PENDING'"), ("device_config", "updated_at", "CURRENT_TIMESTAMP"),
        ("fault_logs", "alert_sent_sms", "false"), ("fault_logs", "alert_sent_whatsapp", "false"),
        ("fault_logs", "contactor_tripped", "true"), ("fault_logs", "occurred_at", "CURRENT_TIMESTAMP"),
        ("otp_challenges", "attempts", "0"), ("otp_challenges", "created_at", "CURRENT_TIMESTAMP"),
        ("pumps", "created_at", "CURRENT_TIMESTAMP"), ("pumps", "lifecycle_state", "'ACTIVE'"), ("pumps", "status", "'STOPPED'"),
        ("refresh_tokens", "created_at", "CURRENT_TIMESTAMP"),
        ("telemetry_history", "buffered", "false"), ("telemetry_history", "fault_active", "false"),
        ("telemetry_history", "pump_on", "false"), ("telemetry_history", "recorded_at", "CURRENT_TIMESTAMP"),
        ("telemetry_history", "ts_approx", "false"),
        ("users", "account_status", "'ACTIVE'"), ("users", "created_at", "CURRENT_TIMESTAMP"), ("users", "dealer_depth", "0"),
        ("users", "is_active", "true"), ("users", "is_verified", "false"), ("users", "org_role", "'owner'"),
        ("users", "preferred_language", "'en'"), ("users", "totp_enabled", "false"), ("users", "updated_at", "now()"),
    ]
    for table, column, expr in defaults:
        set_default(table, column, expr)
    # defaults that invented data
    drop_default("pumps", "hp_rating")                 # an unknown motor size is unknown, not 7.5 HP
    drop_default("telemetry_history", "gsm_rssi")      # a reading with no signal figure is not "24"
    drop_default("fault_code_catalog", "code")         # fault codes are the firmware's, never generated
    op.execute(f"DROP SEQUENCE IF EXISTS {S}.fault_code_catalog_code_seq")

    # ---- NOT NULL: what the rows must always have (skipped, with a warning, where existing rows say otherwise)
    for table, column, fill in [
        ("batch_imeis", "claimed", "false"), ("device_batches", "quantity", "0"), ("device_batches", "revoked", "false"),
        ("config_templates", "desired_json", "'{}'::jsonb"), ("pumps", "supply_type", "'3-phase'"),
        ("fault_logs", "description", "'Fault'"),
        ("users", "is_active", "true"), ("users", "is_verified", "false"), ("users", "created_at", "now()"),
        ("users", "updated_at", "now()"), ("telemetry_history", "recorded_at", "now()"),
        ("config_templates", "owner_hierarchy_path", ""), ("config_templates", "owner_user_id", ""),
        ("pumps", "owner_user_id", ""), ("users", "role", ""), ("users", "hierarchy_path", ""),
    ]:
        set_not_null(table, column, fill)

    # ---- CHECK constraints (values the application and the firmware actually use)
    sev = "('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')"
    add_check("users", "users_role_check", "role IN ('superadmin', 'manufacturer', 'distributor', 'dealer', 'customer')")
    add_check("users", "users_account_status_check", "account_status IN ('ACTIVE', 'SUSPENDED')")
    add_check("users", "users_org_role_check", "org_role IN ('owner', 'staff', 'readonly')")
    add_check("users", "users_dealer_depth_check", "dealer_depth >= 0 AND dealer_depth <= 6")
    add_check("pumps", "pumps_status_check", "status IN ('RUNNING', 'STOPPED', 'FAULT')")
    add_check("pumps", "pumps_supply_type_check", "supply_type IN ('3-phase', '1-phase')")
    add_check("pumps", "pumps_lifecycle_state_check",
              "lifecycle_state IN ('MANUFACTURED', 'ALLOCATED', 'IN_STOCK', 'COMMISSIONED', 'ACTIVE', 'SUSPENDED', 'RMA', 'RETIRED')")
    add_check("alerts", "alerts_alert_type_check", "alert_type IN ('FAULT', 'OFFLINE')")
    add_check("alerts", "alerts_severity_check", f"severity IN {sev}")
    add_check("alert_subscriptions", "alert_subscriptions_alert_type_check", "alert_type IN ('FAULT', 'OFFLINE')")
    add_check("alert_subscriptions", "alert_subscriptions_min_severity_check", f"min_severity IN {sev}")
    add_check("fault_code_catalog", "fault_code_catalog_severity_check", f"severity IN {sev}")
    add_check("device_config", "device_config_status_check", "status IN ('PENDING', 'APPLIED', 'FAILED')")
    add_check("branding", "branding_primary_color_check", "theme_color ~ '^#[0-9a-fA-F]{6}$'")

    # ---- foreign keys: what happens to dependants when the parent goes
    for table, column, ref, on_delete, name in [
        ("alerts", "pump_id", "pumps", "CASCADE", "alerts_pump_id_fkey"),
        ("allocation_log", "pump_id", "pumps", "CASCADE", "allocation_log_pump_id_fkey"),
        ("batch_imeis", "pump_id", "pumps", "SET NULL", "batch_imeis_pump_id_fkey"),
        ("commands", "pump_id", "pumps", "CASCADE", "commands_pump_id_fkey"),
        ("device_config", "pump_id", "pumps", "CASCADE", "device_config_pump_id_fkey"),
        ("fault_logs", "pump_id", "pumps", "CASCADE", "fault_logs_pump_id_fkey"),
        ("telemetry_history", "pump_id", "pumps", "CASCADE", "telemetry_history_pump_id_fkey"),
    ]:
        set_fk(table, column, ref, on_delete, name)
    for table, column, on_delete, name in [
        ("config_templates", "created_by", "SET NULL", "config_templates_created_by_fkey"),
        ("config_templates", "owner_user_id", "CASCADE", "config_templates_owner_user_id_fkey"),
        ("device_batches", "created_by", "SET NULL", "device_batches_created_by_fkey"),
        ("device_config", "updated_by", "SET NULL", "device_config_updated_by_fkey"),
        ("fault_logs", "ack_by_user_id", "SET NULL", "fault_logs_ack_by_user_id_fkey"),
    ]:
        set_fk(table, column, "users", on_delete, name, on_update=False)

    # ---- uniqueness: one account per phone number, one alert per (pump, type, code, window)
    unique_on("users", "phone_number", "users_phone_number_key")
    unique_on("users", "phone", "users_phone_key")           # login finds the account by `phone`: it must be one account
    unique_on("fault_code_catalog", "name", "fault_code_catalog_name_key")
    add_index("idx_alerts_dedup", "alerts", "(pump_id, alert_type, COALESCE((fault_code)::integer, -1), dedup_bucket)", unique=True)

    # ---- indexes the queries depend on
    for name, table, definition in [
        ("idx_alert_subscriptions_user", "alert_subscriptions", "(user_id)"),
        ("idx_alerts_open", "alerts", "(resolved_at) WHERE resolved_at IS NULL"),
        ("idx_alerts_pump_time", "alerts", "(pump_id, last_occurred_at DESC)"),
        ("idx_allocation_log_pump", "allocation_log", "(pump_id, occurred_at DESC)"),
        ("idx_audit_log_actor", "audit_log", "(actor_id, occurred_at DESC)"),
        ("idx_audit_log_entity", "audit_log", "(entity_type, entity_id, occurred_at DESC)"),
        ("idx_batch_imeis_batch", "batch_imeis", "(batch_id)"),
        ("idx_commands_pump_time", "commands", "(pump_id, issued_at DESC)"),
        ("idx_config_templates_owner_path", "config_templates", "(owner_hierarchy_path text_pattern_ops)"),
        ("idx_fault_logs_pump", "fault_logs", "(pump_id, occurred_at DESC)"),
        ("idx_otp_expires", "otp_challenges", "(expires_at)"),
        ("idx_pumps_hierarchy_path", "pumps", "(hierarchy_path text_pattern_ops)"),
        ("idx_pumps_lat_lng", "pumps", "(latitude, longitude)"),
        ("idx_refresh_tokens_hash", "refresh_tokens", "(token_hash)"),
        ("idx_refresh_tokens_user", "refresh_tokens", "(user_id)"),
        ("idx_telemetry_pump_time", "telemetry_history", "(pump_id, recorded_at DESC)"),
        ("idx_users_hierarchy_path", "users", "(hierarchy_path text_pattern_ops)"),
        ("idx_users_phone", "users", "(phone_number)"),
    ]:
        add_index(name, table, definition)

    # ---- reference data the application cannot work without (SRS §6.2); existing rows are left as they are
    op.execute(f"""
    INSERT INTO {S}.fault_code_catalog (code, name, severity, description) VALUES
        (0, 'None', 'LOW', 'No fault'),
        (1, 'YPhase', 'CRITICAL', 'Y-phase fault'),
        (2, 'PhaseLoss', 'CRITICAL', 'Phase loss / single phasing'),
        (3, 'OverVolt', 'MEDIUM', 'Over-voltage'),
        (4, 'PhaseSeq', 'CRITICAL', 'Phase sequence wrong'),
        (5, 'DryRun', 'HIGH', 'Dry run / underload'),
        (6, 'CableAll', 'CRITICAL', 'Cable open, all phases'),
        (7, 'CablePart', 'CRITICAL', 'Cable open, partial'),
        (8, 'OverLoad', 'HIGH', 'Overload'),
        (9, 'Imbalance', 'MEDIUM', 'Voltage imbalance'),
        (10, 'UnderVolt', 'MEDIUM', 'Under-voltage')
    ON CONFLICT (code) DO NOTHING""")
    set_not_null("fault_code_catalog", "description", "'(no description)'")


def downgrade() -> None:
    pass
