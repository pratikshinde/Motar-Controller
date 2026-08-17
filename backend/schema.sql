-- ============================================================================
-- IoT Agricultural & Domestic Water Pump Monitoring Ecosystem
-- PostgreSQL Database Schema with Path Enumeration
-- Schema: agripump (Isolated inside propcb database)
--
-- v2 — 17 Aug 2026. Changes from v1 (see Web_App_Pending_Items.md):
--   - Dealer hierarchy collapsed from 5 fixed roles (dealer1..dealer5) to a
--     single 'dealer' role with a computed `depth`, per SRS FR-SEC-000a/b.
--   - Device lifecycle state added (SRS §7.3).
--   - Allocation log, append-only audit log, and device desired/reported
--     configuration storage added (FR-SEC-003, FR-CLD-062, §6.4).
--   - Fault codes normalised to the numeric 0-10 SRS §6.2 scheme via a
--     lookup table (FR-CON-033), replacing free-text fault_code strings.
--   - Command dispatch table added, with a server-enforced 45s cooldown
--     per pump (the existing UI cooldown was client-only).
--   - Per-device telemetry ingestion key added (closes SEC-1).
--   - Refresh-token table added for short-lived access tokens (FR-CLD-041).
--   - power_factor / frequency dropped (out of scope per SRS §1.2 — the
--     hardware does not measure either); gsm_rssi and firmware_version no
--     longer carry fabricated defaults.
--
-- NOT addressed here (explicitly out of scope for this pass — see D-6 in
-- Reconciliation_Report.md): a separate `organisation` entity, panel
-- records, and subscription/billing state. All three depend on the D-6
-- decision (organisation entity vs. users-carry-hierarchy) which the dev
-- plan marks "Open — decide before 1B" and is not this pass's call to make.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS agripump;
SET search_path TO agripump, public;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PostGIS extension not available on this PostgreSQL instance. Using standard numeric lat/lng columns.';
END $$;

-- ----------------------------------------------------------------------------
-- 1. USERS & HIERARCHY TABLE WITH AUTH CREDENTIALS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agripump.users (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    full_name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20) UNIQUE NOT NULL, -- E.164 format (+919876543210)
    email VARCHAR(100),
    password_hash VARCHAR(255), -- Securely hashed password for admin accounts
    role VARCHAR(30) NOT NULL CHECK (
        role IN ('superadmin', 'manufacturer', 'distributor', 'dealer', 'customer')
    ),
    -- Path Enumeration String for O(1) Hierarchy Tree Scoping
    hierarchy_path TEXT NOT NULL,
    parent_user_id UUID REFERENCES agripump.users(id) ON DELETE SET NULL,
    -- Computed at write time by the application (POST /api/users): number of
    -- 'dealer' ancestors between this row and the owning distributor. Only
    -- meaningful for role='dealer'; enforced <= 6 per FR-SEC-000a. Not a
    -- generated column because Postgres can't self-join for a GENERATED
    -- ALWAYS expression — the app computes it from the parent's depth.
    dealer_depth SMALLINT NOT NULL DEFAULT 0 CHECK (dealer_depth >= 0 AND dealer_depth <= 6),
    preferred_language VARCHAR(10) DEFAULT 'en',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Forward-compatible ALTERs so this script stays idempotent against an
-- installation created from the v1 schema.
ALTER TABLE agripump.users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
ALTER TABLE agripump.users ADD COLUMN IF NOT EXISTS dealer_depth SMALLINT NOT NULL DEFAULT 0;

-- FR-WEB-001 — TOTP MFA, mandatory for superadmin and manufacturer roles.
-- totp_secret is set (but totp_enabled stays false) as soon as the user
-- starts enrollment; it only becomes the live credential once a correct
-- code confirms the phone and server clocks agree (POST /api/auth/mfa/enable).
ALTER TABLE agripump.users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(64);
ALTER TABLE agripump.users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- P-1 (Web_App_Pending_Items.md §8.1.2) — multiple staff logins sharing one
-- partner's device pool. org_node_id is nullable and self-referential: a
-- staff login points at the user row that "owns" the shared hierarchy_path
-- (which may be itself, for the owner). Deliberately NOT a foreign key to a
-- separate organisation table — D-6 stays decided against that; this reuses
-- the existing tree instead of adding a second one beside it.
ALTER TABLE agripump.users ADD COLUMN IF NOT EXISTS org_node_id UUID REFERENCES agripump.users(id) ON DELETE SET NULL;
ALTER TABLE agripump.users ADD COLUMN IF NOT EXISTS org_role VARCHAR(10) DEFAULT 'owner' CHECK (org_role IN ('owner', 'staff', 'readonly'));

-- FR-WEB-012 — manufacturer org CRUD (create/edit/suspend/delete), contract
-- details and device quotas. Generic on `users` rather than manufacturer-only
-- so the same suspend mechanism works for any subordinate account.
ALTER TABLE agripump.users ADD COLUMN IF NOT EXISTS account_status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE', 'SUSPENDED'));
ALTER TABLE agripump.users ADD COLUMN IF NOT EXISTS contract_notes TEXT;
ALTER TABLE agripump.users ADD COLUMN IF NOT EXISTS device_quota INT;

-- Migrate legacy dealer1..dealer5 rows (if this is an upgrade from v1) to the
-- single 'dealer' role with an equivalent computed depth, then relax the
-- CHECK constraint. Safe to run against a fresh v2 install (no rows match).
DO $$
BEGIN
    UPDATE agripump.users SET dealer_depth = 1, role = 'dealer' WHERE role = 'dealer1';
    UPDATE agripump.users SET dealer_depth = 2, role = 'dealer' WHERE role = 'dealer2';
    UPDATE agripump.users SET dealer_depth = 3, role = 'dealer' WHERE role = 'dealer3';
    UPDATE agripump.users SET dealer_depth = 4, role = 'dealer' WHERE role = 'dealer4';
    UPDATE agripump.users SET dealer_depth = 5, role = 'dealer' WHERE role = 'dealer5';
EXCEPTION WHEN undefined_column OR check_violation THEN
    NULL; -- fresh install, nothing to migrate
END $$;

ALTER TABLE agripump.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE agripump.users ADD CONSTRAINT users_role_check
    CHECK (role IN ('superadmin', 'manufacturer', 'distributor', 'dealer', 'customer'));
ALTER TABLE agripump.users DROP CONSTRAINT IF EXISTS users_dealer_depth_check;
ALTER TABLE agripump.users ADD CONSTRAINT users_dealer_depth_check
    CHECK (dealer_depth >= 0 AND dealer_depth <= 6);

CREATE INDEX IF NOT EXISTS idx_users_hierarchy_path ON agripump.users (hierarchy_path text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_users_phone ON agripump.users (phone_number);

-- ----------------------------------------------------------------------------
-- 2. OTP CHALLENGE STATE TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agripump.otp_challenges (
    phone_number VARCHAR(20) PRIMARY KEY,
    otp_code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    attempts INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_otp_expires ON agripump.otp_challenges (expires_at);

-- ----------------------------------------------------------------------------
-- 2B. REFRESH TOKENS (FR-CLD-041 — short-lived access tokens, rotating
--     refresh tokens, revocable within 60s)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agripump.refresh_tokens (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES agripump.users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL, -- sha256 hex of the refresh token; the raw token is never stored
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE,
    replaced_by UUID REFERENCES agripump.refresh_tokens(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON agripump.refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON agripump.refresh_tokens (user_id);

-- ----------------------------------------------------------------------------
-- 3. PUMPS & DEVICE REGISTRY TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agripump.pumps (
    id VARCHAR(50) PRIMARY KEY, -- Device Thing Name. NOTE (open decision D-4,
                                 -- Reconciliation_Report.md): SRS §6.7 requires
                                 -- this to equal the MCU 96-bit UID and the
                                 -- certificate CN once real devices exist. The
                                 -- human-readable "PUMP-4G-3P-####" pattern
                                 -- used here is a placeholder for pre-hardware
                                 -- development and is NOT resolved by this pass.
    name VARCHAR(100) NOT NULL, -- Human name: "Borewell Pump #1"
    supply_type VARCHAR(10) NOT NULL CHECK (supply_type IN ('3-phase', '1-phase')),
    hp_rating NUMERIC(4, 1) DEFAULT 7.5,

    owner_user_id UUID NOT NULL REFERENCES agripump.users(id) ON DELETE CASCADE,
    installed_by_user_id UUID REFERENCES agripump.users(id) ON DELETE SET NULL,
    hierarchy_path TEXT NOT NULL, -- Inherited from owner for fast tree querying

    latitude NUMERIC(10, 6) NOT NULL,
    longitude NUMERIC(10, 6) NOT NULL,

    firmware_version VARCHAR(20), -- no fabricated default; NULL until the device actually reports one
    status VARCHAR(20) DEFAULT 'STOPPED' CHECK (status IN ('RUNNING', 'STOPPED', 'FAULT')),

    -- Device lifecycle state, SRS §7.3. Distinct from `status` (operational
    -- state) above.
    lifecycle_state VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (
        lifecycle_state IN ('MANUFACTURED', 'ALLOCATED', 'IN_STOCK', 'COMMISSIONED', 'ACTIVE', 'SUSPENDED', 'RMA', 'RETIRED')
    ),

    -- Per-device shared secret for authenticating inbound telemetry (SEC-1).
    -- Format matches users.password_hash: "salt_hex:scrypt_hash_hex". This is
    -- an interim HTTP-ingestion control, not a replacement for the SRS §6.7
    -- target of per-device X.509 client certs over AWS IoT mutual TLS — that
    -- remains bridge/firmware work (Stream 3) outside this pass's scope.
    device_key_hash VARCHAR(255),

    last_command_at TIMESTAMP WITH TIME ZONE, -- for server-side command cooldown enforcement
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE agripump.pumps ALTER COLUMN firmware_version DROP DEFAULT;
ALTER TABLE agripump.pumps ADD COLUMN IF NOT EXISTS lifecycle_state VARCHAR(20) NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE agripump.pumps ADD COLUMN IF NOT EXISTS device_key_hash VARCHAR(255);
ALTER TABLE agripump.pumps ADD COLUMN IF NOT EXISTS last_command_at TIMESTAMP WITH TIME ZONE;
-- §8.4 Ownership tab (Web_App_Pending_Items.md §6) — warranty is tracked
-- directly on the pump rather than a separate table: one warranty period
-- per device, editable by Superadmin, NULL until set (never a fabricated
-- default duration).
ALTER TABLE agripump.pumps ADD COLUMN IF NOT EXISTS warranty_start_date DATE;
ALTER TABLE agripump.pumps ADD COLUMN IF NOT EXISTS warranty_period_months INT;
-- FR-WEB-031 — panel binding. Direct columns, not a separate table: this
-- is a 1:1 relationship with the pump (one panel per device), same shape
-- as warranty and hp_rating already on this row. `motor_rating` is a
-- free-text nameplate value (e.g. "15 HP / 11 kW"), distinct from the numeric
-- `hp_rating` column used for fleet aggregates — a panel's nameplate can
-- carry more than the single HP figure the rest of the app computes with.
ALTER TABLE agripump.pumps ADD COLUMN IF NOT EXISTS panel_serial VARCHAR(50);
ALTER TABLE agripump.pumps ADD COLUMN IF NOT EXISTS motor_rating VARCHAR(50);
ALTER TABLE agripump.pumps ADD COLUMN IF NOT EXISTS starter_type VARCHAR(30);
ALTER TABLE agripump.pumps ADD COLUMN IF NOT EXISTS pump_make VARCHAR(50);
ALTER TABLE agripump.pumps ADD COLUMN IF NOT EXISTS pump_model VARCHAR(50);
ALTER TABLE agripump.pumps DROP CONSTRAINT IF EXISTS pumps_lifecycle_state_check;
ALTER TABLE agripump.pumps ADD CONSTRAINT pumps_lifecycle_state_check CHECK (
    lifecycle_state IN ('MANUFACTURED', 'ALLOCATED', 'IN_STOCK', 'COMMISSIONED', 'ACTIVE', 'SUSPENDED', 'RMA', 'RETIRED')
);

CREATE INDEX IF NOT EXISTS idx_pumps_lat_lng ON agripump.pumps (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_pumps_hierarchy_path ON agripump.pumps (hierarchy_path text_pattern_ops);

-- ----------------------------------------------------------------------------
-- 4. TELEMETRY HISTORY TABLE
--    power_factor and frequency removed: the PCD hardware does not measure
--    either (SRS §1.2, §4.1 FR-DEV-004) and their v1 defaults (0.88 / 50.0)
--    were fabricated on every row. gsm_rssi and firmware_version no longer
--    default to a plausible-looking made-up value.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agripump.telemetry_history (
    id BIGSERIAL PRIMARY KEY,
    pump_id VARCHAR(50) NOT NULL REFERENCES agripump.pumps(id) ON DELETE CASCADE,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    v_ry NUMERIC(5, 1), -- Phase R-Y Voltage
    v_yb NUMERIC(5, 1), -- Phase Y-B Voltage
    v_br NUMERIC(5, 1), -- Phase B-R Voltage

    i_r NUMERIC(5, 2),  -- Phase R Current
    i_y NUMERIC(5, 2),  -- Phase Y Current
    i_b NUMERIC(5, 2),  -- Phase B Current

    gsm_rssi INT, -- dBm, nullable, no fabricated default

    pump_on BOOLEAN DEFAULT FALSE,
    fault_active BOOLEAN DEFAULT FALSE,

    -- Layer-B enrichment fields per SRS §6.3 (seq/tsApprox added when the
    -- bridge exists to supply them; nullable so the simulator can populate
    -- them now without waiting on Stream 3).
    seq BIGINT,
    ts_approx BOOLEAN DEFAULT FALSE,
    buffered BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_telemetry_pump_time ON agripump.telemetry_history (pump_id, recorded_at DESC);

-- Forward-compatible ALTERs, matching the pattern already used for `users`
-- and `pumps` above: CREATE TABLE IF NOT EXISTS is a no-op against a
-- database provisioned before these three columns existed, so without this
-- they stay permanently missing on any such database.
ALTER TABLE agripump.telemetry_history ADD COLUMN IF NOT EXISTS seq BIGINT;
ALTER TABLE agripump.telemetry_history ADD COLUMN IF NOT EXISTS ts_approx BOOLEAN DEFAULT FALSE;
ALTER TABLE agripump.telemetry_history ADD COLUMN IF NOT EXISTS buffered BOOLEAN DEFAULT FALSE;

-- The reverse case: a database from before the SEC fix above still carries
-- power_factor/frequency, and every row in them is a fabricated 0.88/50.0
-- default, never a real reading (SRS §1.2 — the hardware doesn't measure
-- either). CREATE TABLE IF NOT EXISTS can't retroactively drop a column,
-- so without this, `SELECT *` call sites (GET /api/pumps/:id) keep leaking
-- invented data into API responses on any database from before this line
-- existed. There is no real measurement in either column to lose.
ALTER TABLE agripump.telemetry_history DROP COLUMN IF EXISTS power_factor;
ALTER TABLE agripump.telemetry_history DROP COLUMN IF EXISTS frequency;

-- ----------------------------------------------------------------------------
-- 5. FAULT CODE CATALOG — single source of truth (FR-CON-033), numeric
--    0-10 scheme from SRS §6.2 (MotorProtection.h). This replaces the free
--    -text VARCHAR(30) fault_code that fault_logs used in v1.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agripump.fault_code_catalog (
    code SMALLINT PRIMARY KEY,
    name VARCHAR(30) NOT NULL,
    severity VARCHAR(10) NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
    description TEXT NOT NULL
);

INSERT INTO agripump.fault_code_catalog (code, name, severity, description) VALUES
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
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, severity = EXCLUDED.severity, description = EXCLUDED.description;

-- ----------------------------------------------------------------------------
-- 6. FAULT INCIDENT & PROTECTION LOGS TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agripump.fault_logs (
    id BIGSERIAL PRIMARY KEY,
    pump_id VARCHAR(50) NOT NULL REFERENCES agripump.pumps(id) ON DELETE CASCADE,
    occurred_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    fault_code SMALLINT REFERENCES agripump.fault_code_catalog(code),
    description TEXT NOT NULL,
    v_yb_snapshot NUMERIC(5, 1),
    contactor_tripped BOOLEAN DEFAULT TRUE,
    alert_sent_sms BOOLEAN DEFAULT FALSE,
    alert_sent_whatsapp BOOLEAN DEFAULT FALSE,
    ack_by_user_id UUID REFERENCES agripump.users(id) ON DELETE SET NULL,
    ack_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE
);

-- Migrate legacy free-text fault_code (if upgrading from v1) into the new
-- numeric column via a best-effort name match, then drop the old column.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'agripump' AND table_name = 'fault_logs'
          AND column_name = 'fault_code' AND data_type = 'character varying'
    ) THEN
        ALTER TABLE agripump.fault_logs RENAME COLUMN fault_code TO fault_code_legacy_text;
        ALTER TABLE agripump.fault_logs ADD COLUMN fault_code SMALLINT REFERENCES agripump.fault_code_catalog(code);
        UPDATE agripump.fault_logs SET fault_code = CASE fault_code_legacy_text
            WHEN 'ERR_PHASE_LOSS' THEN 2
            WHEN 'ERR_SINGLE_PHASING' THEN 2
            WHEN 'ERR_OVERLOAD' THEN 8
            WHEN 'ERR_DRY_RUN' THEN 5
            WHEN 'ERR_OVER_VOLT' THEN 3
            WHEN 'ERR_UNDER_VOLT' THEN 10
            WHEN 'ERR_IMBALANCE' THEN 9
            ELSE 0
        END;
        -- fault_code_legacy_text is kept, not dropped, so a bad guess above
        -- is recoverable by hand rather than silently lost.
    END IF;
END $$;

-- The rename above carries the original column's NOT NULL constraint over
-- onto fault_code_legacy_text. Every fault_logs insert going forward only
-- writes the new numeric fault_code, so on any database that has actually
-- run the migration above, that inherited constraint makes every such
-- insert fail — a separate, unconditional fix, since the migration block's
-- own guard (fault_code being character varying) is only ever true once
-- and won't re-fire to pick this up on a database that already migrated.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'agripump' AND table_name = 'fault_logs' AND column_name = 'fault_code_legacy_text'
    ) THEN
        ALTER TABLE agripump.fault_logs ALTER COLUMN fault_code_legacy_text DROP NOT NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fault_logs_pump ON agripump.fault_logs (pump_id, occurred_at DESC);

-- Forward-compatible ALTERs for the acknowledge/resolve workflow columns
-- (POST /api/pumps/:id/faults/:faultId/ack): CREATE TABLE IF NOT EXISTS is
-- a no-op on a database that already has fault_logs from before these
-- existed, same gap as telemetry_history above.
ALTER TABLE agripump.fault_logs ADD COLUMN IF NOT EXISTS ack_by_user_id UUID REFERENCES agripump.users(id) ON DELETE SET NULL;
ALTER TABLE agripump.fault_logs ADD COLUMN IF NOT EXISTS ack_at TIMESTAMP WITH TIME ZONE;

-- ----------------------------------------------------------------------------
-- 7. DEVICE CONFIGURATION (desired vs. reported), SRS §6.4
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agripump.device_config (
    pump_id VARCHAR(50) PRIMARY KEY REFERENCES agripump.pumps(id) ON DELETE CASCADE,
    desired_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    reported_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPLIED', 'FAILED')),
    updated_by UUID REFERENCES agripump.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- 8. COMMAND DISPATCH LOG (start/stop, cooldown, ack correlation)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agripump.commands (
    cid UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    pump_id VARCHAR(50) NOT NULL REFERENCES agripump.pumps(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES agripump.users(id) ON DELETE SET NULL,
    action VARCHAR(10) NOT NULL CHECK (action IN ('START', 'STOP')),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACKED', 'EXPIRED', 'REJECTED')),
    reject_reason VARCHAR(50),
    issued_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    acked_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_commands_pump_time ON agripump.commands (pump_id, issued_at DESC);

-- ----------------------------------------------------------------------------
-- 9. ALLOCATION LOG — ownership moves, FR-SEC-003
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agripump.allocation_log (
    id BIGSERIAL PRIMARY KEY,
    pump_id VARCHAR(50) NOT NULL REFERENCES agripump.pumps(id) ON DELETE CASCADE,
    from_user_id UUID REFERENCES agripump.users(id) ON DELETE SET NULL,
    to_user_id UUID NOT NULL REFERENCES agripump.users(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES agripump.users(id) ON DELETE SET NULL,
    note TEXT,
    occurred_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_allocation_log_pump ON agripump.allocation_log (pump_id, occurred_at DESC);

-- ----------------------------------------------------------------------------
-- 10. AUDIT LOG — append-only, FR-CLD-062
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agripump.audit_log (
    id BIGSERIAL PRIMARY KEY,
    actor_id UUID REFERENCES agripump.users(id) ON DELETE SET NULL,
    actor_role VARCHAR(30),
    entity_type VARCHAR(30) NOT NULL,
    entity_id VARCHAR(50) NOT NULL,
    action VARCHAR(30) NOT NULL,
    before_json JSONB,
    after_json JSONB,
    ip VARCHAR(45),
    occurred_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON agripump.audit_log (entity_type, entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON agripump.audit_log (actor_id, occurred_at DESC);

-- Enforce append-only at the database level: no DELETE, from any role,
-- ever. Recreated on every run so the rule stays in force after an upgrade.
--
-- There is deliberately no matching "no update" rule. There was one until
-- FR-WEB-012's DELETE /api/users/:id turned out to always fail with
-- "referential integrity query ... gave unexpected result": deleting a
-- user fires audit_log_actor_id_fkey's ON DELETE SET NULL, which is
-- itself an UPDATE against audit_log — an unconditional rule can't tell
-- that cascade apart from an arbitrary rewrite, so it silently no-ops the
-- cascade too, and Postgres's FK trigger machinery chokes on the mismatch.
-- No code path in this app issues UPDATE to audit_log (grep confirms only
-- the one INSERT in writeAudit), so the practical guarantee — application
-- code cannot alter a written row — holds without the rule; what's lost is
-- only the (already partial, given this is a single trusted DB role)
-- protection against a hand-run UPDATE at the psql prompt.
DROP RULE IF EXISTS audit_log_no_update ON agripump.audit_log;
CREATE OR REPLACE RULE audit_log_no_delete AS ON DELETE TO agripump.audit_log DO INSTEAD NOTHING;

-- ----------------------------------------------------------------------------
-- 11. FACTORY PROVISIONING — device batches & IMEI whitelist
--     FR-WEB-010 (bulk inventory import), FR-WEB-011 (factory console),
--     C-1 (claim gating by whitelisted IMEI). One mechanism serves all
--     three per Web_App_Pending_Items.md §5.1/§5.2 — a batch's IMEI list
--     *is* the inventory import *is* the claim whitelist.
--
--     Device identity: `imei` is the modem's, keyed as the claim
--     credential per D-4 (dev_id = IMEI, not the MCU UID — the MCU is the
--     board actually replaced in service). `mcu_uid` is carried as a
--     reported attribute once a unit registers, not as identity.
--     `pump_id` stays NULL until Stream 3's device-side claim exchange
--     (or a manual commission) actually creates the `pumps` row — the
--     portal side built here is batch creation, whitelist upload and
--     state visibility, not the claim exchange itself.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agripump.device_batches (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    batch_code VARCHAR(50) UNIQUE NOT NULL,
    model VARCHAR(100) NOT NULL,
    hw_rev VARCHAR(20),
    quantity INT NOT NULL DEFAULT 0,
    manufacture_date DATE,
    created_by UUID REFERENCES agripump.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS agripump.batch_imeis (
    id BIGSERIAL PRIMARY KEY,
    batch_id UUID NOT NULL REFERENCES agripump.device_batches(id) ON DELETE CASCADE,
    imei VARCHAR(20) UNIQUE NOT NULL,
    mcu_uid VARCHAR(30),
    claimed BOOLEAN NOT NULL DEFAULT FALSE,
    claimed_at TIMESTAMP WITH TIME ZONE,
    pump_id VARCHAR(50) REFERENCES agripump.pumps(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_batch_imeis_batch ON agripump.batch_imeis (batch_id);

-- ----------------------------------------------------------------------------
-- 12. CHILD-ORG INVITE LINKS — FR-WEB-035
--     A shareable link that pre-assigns role + parent hierarchy, so the
--     invited person registers themselves (own phone/password) instead of
--     the parent typing their details in on their behalf (the existing
--     POST /api/users flow, still used for that case). Token is stored
--     hashed (same convention as refresh_tokens) — the raw token exists
--     only in the URL, shown once at creation.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agripump.invite_tokens (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('manufacturer', 'distributor', 'dealer', 'customer')),
    parent_user_id UUID NOT NULL REFERENCES agripump.users(id) ON DELETE CASCADE,
    parent_hierarchy_path TEXT NOT NULL,
    created_by UUID REFERENCES agripump.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    used_by_user_id UUID REFERENCES agripump.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_invite_tokens_parent ON agripump.invite_tokens (parent_user_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 13. WHITE-LABELLING — FR-WEB-036, Web_App_Pending_Items.md §8.1
--     Branding attaches to the manufacturer's own node in the existing
--     `users` tree (D-6 — no separate organisation entity) and resolves
--     for anyone under them by walking up `hierarchy_path`, the same
--     materialised-path mechanism device scoping already uses. One row
--     per manufacturer; `user_id` is UNIQUE rather than the table's PK so
--     a future "branding history" isn't blocked by this shape.
--
--     `notification_sender_name` is stored here but NOT applied at SMS/
--     WhatsApp send time — the doc is explicit that stays coupled to the
--     Stream 1B notification service, not the portal. Storing it now means
--     the settings form doesn't need to change shape when 1B lands.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agripump.branding (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES agripump.users(id) ON DELETE CASCADE,
    logo_url TEXT,
    primary_color VARCHAR(7) NOT NULL CHECK (primary_color ~ '^#[0-9a-fA-F]{6}$'),
    notification_sender_name VARCHAR(50),
    subdomain VARCHAR(63),
    updated_by UUID REFERENCES agripump.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- 14. CONFIGURATION TEMPLATES — FR-WEB-032
--     A named, reusable set of layer-A desired-config keys (§6.1), scoped
--     by the creator's own hierarchy_path (same LIKE-prefix convention as
--     everywhere else) so one tenant's templates aren't visible to
--     another's. Applying a template MERGES into each target pump's
--     existing desired_json rather than replacing it wholesale — see the
--     device_config_full_replace_gotcha note: PUT /api/pumps/:id/config
--     replaces desired_json entirely, so a naive "apply" would silently
--     erase any settings the template doesn't mention.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agripump.config_templates (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    desired_json JSONB NOT NULL,
    owner_user_id UUID NOT NULL REFERENCES agripump.users(id) ON DELETE CASCADE,
    owner_hierarchy_path TEXT NOT NULL,
    created_by UUID REFERENCES agripump.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_config_templates_owner_path ON agripump.config_templates (owner_hierarchy_path text_pattern_ops);

-- ----------------------------------------------------------------------------
-- 15. COMPONENT SWAP HISTORY — FR-WEB-034
--
--     Two distinct swap types (Web_App_Pending_Items.md §4/W1, the RMA
--     table at §7.2): MCU swap is frequent/cheap and does NOT change
--     device identity — the modem/IMEI (and so `pumps.id`, D-4) stays the
--     same, only the "currently fitted MCU" attribute changes. That's
--     `mcu_swap_log`: an append-style history, with the pump's current
--     MCU UID being whichever row is most recent (falling back to the
--     provisioning-time value in `batch_imeis.mcu_uid` if the pump was
--     never swapped).
--
--     Bridge/modem swap is rare/expensive and DOES change identity (a new
--     IMEI = a new `pumps.id`, since IMEI is the identity per D-4). The
--     site's operational history (telemetry, faults, commands,
--     allocations, config) must survive that swap, so this is implemented
--     as a literal rename of the `pumps.id` primary key with the six
--     tables that reference it retrofitted to ON UPDATE CASCADE (below) —
--     history "migrates" for free via the cascade, rather than needing a
--     parallel "supersedes" pointer and application-level merge logic.
--     `bridge_swap_log` is the audit trail of when/why/by-whom that rename
--     happened, keyed by the pump's CURRENT id (the OLD id is gone — it
--     was the primary key that got renamed).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agripump.mcu_swap_log (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    pump_id VARCHAR(50) NOT NULL REFERENCES agripump.pumps(id) ON DELETE CASCADE ON UPDATE CASCADE,
    old_mcu_uid VARCHAR(30),
    new_mcu_uid VARCHAR(30) NOT NULL,
    reason TEXT,
    performed_by UUID REFERENCES agripump.users(id) ON DELETE SET NULL,
    occurred_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mcu_swap_log_pump ON agripump.mcu_swap_log (pump_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS agripump.bridge_swap_log (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    old_pump_id VARCHAR(50) NOT NULL,
    new_pump_id VARCHAR(50) NOT NULL REFERENCES agripump.pumps(id) ON DELETE CASCADE ON UPDATE CASCADE,
    reason TEXT,
    performed_by UUID REFERENCES agripump.users(id) ON DELETE SET NULL,
    occurred_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bridge_swap_log_new ON agripump.bridge_swap_log (new_pump_id, occurred_at DESC);

-- Retrofit ON UPDATE CASCADE onto every existing FK that references
-- pumps.id, so a bridge swap's `UPDATE pumps SET id = <new imei>` carries
-- telemetry/fault/config/command/allocation/batch history to the new id
-- automatically. Idempotent: safe to re-run on an already-migrated DB.
ALTER TABLE agripump.telemetry_history DROP CONSTRAINT IF EXISTS telemetry_history_pump_id_fkey;
ALTER TABLE agripump.telemetry_history ADD CONSTRAINT telemetry_history_pump_id_fkey
    FOREIGN KEY (pump_id) REFERENCES agripump.pumps(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE agripump.fault_logs DROP CONSTRAINT IF EXISTS fault_logs_pump_id_fkey;
ALTER TABLE agripump.fault_logs ADD CONSTRAINT fault_logs_pump_id_fkey
    FOREIGN KEY (pump_id) REFERENCES agripump.pumps(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE agripump.device_config DROP CONSTRAINT IF EXISTS device_config_pump_id_fkey;
ALTER TABLE agripump.device_config ADD CONSTRAINT device_config_pump_id_fkey
    FOREIGN KEY (pump_id) REFERENCES agripump.pumps(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE agripump.commands DROP CONSTRAINT IF EXISTS commands_pump_id_fkey;
ALTER TABLE agripump.commands ADD CONSTRAINT commands_pump_id_fkey
    FOREIGN KEY (pump_id) REFERENCES agripump.pumps(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE agripump.allocation_log DROP CONSTRAINT IF EXISTS allocation_log_pump_id_fkey;
ALTER TABLE agripump.allocation_log ADD CONSTRAINT allocation_log_pump_id_fkey
    FOREIGN KEY (pump_id) REFERENCES agripump.pumps(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE agripump.batch_imeis DROP CONSTRAINT IF EXISTS batch_imeis_pump_id_fkey;
ALTER TABLE agripump.batch_imeis ADD CONSTRAINT batch_imeis_pump_id_fkey
    FOREIGN KEY (pump_id) REFERENCES agripump.pumps(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- 16. ALERT ENGINE — FR-WEB-060/062/063 (scoped down per product-owner
--     direction, 17 Aug 2026: SMS/WhatsApp/email are a later paid add-on,
--     not built here — the only delivery channel is in-app over the
--     existing WebSocket hub while a user is connected; FR-WEB-061's
--     other channels and FR-WEB-064's outbound templates are out of
--     scope until that add-on exists).
--
--     `alerts` is deliberately separate from `fault_logs`: fault_logs'
--     ack_by_user_id/ack_at/resolved_at are device/panel-reset state
--     (SRS §7.2), while alerts.acknowledged_by/assigned_to/resolved_at
--     are a human support-workflow layer (FR-WEB-063) that can outlive or
--     precede the underlying fault's own state, and also covers non-fault
--     alert types (OFFLINE today; e.g. WARRANTY_EXPIRING later) that have
--     no fault_logs row to attach ack state to at all.
--
--     Dedup (FR-WEB-062, default 15 min) is a time-bucket, not a sliding
--     window: dedup_bucket = floor(epoch / 900) turns "insert-or-bump"
--     into one atomic INSERT ... ON CONFLICT ... DO UPDATE. Two
--     occurrences 2 minutes apart but straddling a bucket boundary won't
--     dedupe against each other — accepted approximation, not worth a
--     sliding-window's locking/compaction machinery for v1.
--
--     Dedup identity is (pump_id, alert_type, fault_code, dedup_bucket) —
--     NOT source_fault_log_id. A fresh fault_logs row is created on every
--     single fault report by construction (that's what a log is), so
--     keying dedup on its id would never match twice and dedup would be a
--     no-op; fault_code is what's actually stable across repeats of "the
--     same fault." source_fault_log_id is still stored (bumped to the
--     latest occurrence on every dedup update) purely for traceability —
--     "which fault_logs row is this alert's most recent evidence."
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agripump.alerts (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    pump_id VARCHAR(50) NOT NULL REFERENCES agripump.pumps(id) ON DELETE CASCADE ON UPDATE CASCADE,
    alert_type VARCHAR(20) NOT NULL CHECK (alert_type IN ('FAULT', 'OFFLINE')),
    severity VARCHAR(10) NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
    fault_code SMALLINT REFERENCES agripump.fault_code_catalog(code),
    source_fault_log_id BIGINT REFERENCES agripump.fault_logs(id) ON DELETE SET NULL,
    dedup_bucket BIGINT NOT NULL,
    occurrence_count INT NOT NULL DEFAULT 1,
    first_occurred_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_occurred_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    acknowledged_by UUID REFERENCES agripump.users(id) ON DELETE SET NULL,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    assigned_to UUID REFERENCES agripump.users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_note TEXT
);

-- CREATE TABLE IF NOT EXISTS is a no-op against an already-created table
-- (as this one was, in an earlier revision, before fault_code existed on
-- it) — an explicit ADD COLUMN keeps a re-run of this script idempotent
-- against a live DB either way.
ALTER TABLE agripump.alerts ADD COLUMN IF NOT EXISTS fault_code SMALLINT REFERENCES agripump.fault_code_catalog(code);

-- An expression index, not a plain UNIQUE constraint: Postgres treats every
-- NULL as distinct for uniqueness purposes, and fault_code is always NULL
-- for OFFLINE alerts — a plain UNIQUE(..., fault_code, ...) would silently
-- defeat dedup for that entire alert type. COALESCE to a sentinel (-1,
-- never a real fault_code since fault_code_catalog starts at 0)
-- so OFFLINE alerts dedup against each other too. DROP + CREATE (not
-- CREATE ... IF NOT EXISTS) since an earlier revision of this index
-- existed under the same name keyed on the wrong column.
DROP INDEX IF EXISTS agripump.idx_alerts_dedup;
CREATE UNIQUE INDEX idx_alerts_dedup
    ON agripump.alerts (pump_id, alert_type, COALESCE(fault_code, -1), dedup_bucket);
CREATE INDEX IF NOT EXISTS idx_alerts_pump_time ON agripump.alerts (pump_id, last_occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_open ON agripump.alerts (resolved_at) WHERE resolved_at IS NULL;

-- FR-WEB-060 — no "device group" entity exists anywhere in this schema
-- (D-6 already declined to invent entities hierarchy_path can proxy for),
-- so "per device or per device group" is implemented as: pump_id = a
-- specific device, pump_id NULL = every device in the subscriber's own
-- hierarchy scope ("group" = "my fleet"). A user with zero rows is
-- subscribed to everything in scope by default (preserves the behavior
-- every connected user already gets today via the raw fault broadcast) —
-- rows exist only to narrow or mute, not to opt in.
CREATE TABLE IF NOT EXISTS agripump.alert_subscriptions (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES agripump.users(id) ON DELETE CASCADE,
    pump_id VARCHAR(50) REFERENCES agripump.pumps(id) ON DELETE CASCADE,
    alert_type VARCHAR(20) CHECK (alert_type IN ('FAULT', 'OFFLINE')),
    min_severity VARCHAR(10) CHECK (min_severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
    muted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_user ON agripump.alert_subscriptions (user_id);

-- ----------------------------------------------------------------------------
-- SAMPLE INITIAL SEED DATA
--
-- SEC-2 fix: the v1 seed shipped a *real* personal mobile number
-- (+919741323830) and a superadmin password hash whose plaintext
-- ("admin123") was documented in a comment right next to it — both in git.
-- v2 seeds a placeholder number and NO password hash for the superadmin;
-- setup-db.js now generates a random superadmin password after this script
-- runs and prints it once. Rotate the old admin123 password / revoke the
-- old customer number's session if this v1 seed was ever applied to a
-- reachable database.
-- ----------------------------------------------------------------------------
INSERT INTO agripump.users (id, full_name, phone_number, role, hierarchy_path, dealer_depth, preferred_language, password_hash)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Superadmin Platform', '+910000000001', 'superadmin', '11111111-1111-1111-1111-111111111111', 0, 'en', NULL),
  ('22222222-2222-2222-2222-222222222222', 'Ramesh Patel (Farmer)', '+910000000002', 'customer', '11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222', 0, 'hi', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO agripump.pumps (id, name, supply_type, hp_rating, owner_user_id, hierarchy_path, latitude, longitude, status, lifecycle_state)
VALUES
  ('PUMP-4G-3P-8821', 'Borewell Pump #1', '3-phase', 15.0, '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222', 19.9975, 73.7898, 'RUNNING', 'ACTIVE'),
  ('PUMP-4G-3P-4412', 'Canal Pump #2', '3-phase', 7.5, '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222', 20.0050, 73.7620, 'FAULT', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;
