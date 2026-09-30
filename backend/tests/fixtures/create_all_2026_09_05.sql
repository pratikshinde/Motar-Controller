-- FIXTURE ONLY. The structure of a database built by `Base.metadata.create_all` with the models of 2026-09-05 (git 6921c47):
-- how the first server database was most likely created, before Alembic existed. Never use it to create a database;
-- tests/test_schema_migrations.py loads it, adds old-shape rows and proves `alembic upgrade head` brings it up to date.
--
-- PostgreSQL database dump
--


-- Dumped from database version 18.4
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: agripump; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA agripump;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: alert_subscriptions; Type: TABLE; Schema: agripump; Owner: -
--

CREATE TABLE agripump.alert_subscriptions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    pump_id character varying(50),
    alert_type character varying(20),
    min_severity character varying(10),
    muted boolean NOT NULL,
    created_at timestamp with time zone
);


--
-- Name: alerts; Type: TABLE; Schema: agripump; Owner: -
--

CREATE TABLE agripump.alerts (
    id uuid NOT NULL,
    pump_id character varying(50) NOT NULL,
    alert_type character varying(20) NOT NULL,
    severity character varying(10) NOT NULL,
    fault_code smallint,
    source_fault_log_id bigint,
    dedup_bucket bigint NOT NULL,
    occurrence_count integer NOT NULL,
    first_occurred_at timestamp with time zone,
    last_occurred_at timestamp with time zone,
    acknowledged_by uuid,
    acknowledged_at timestamp with time zone,
    assigned_to uuid,
    resolved_at timestamp with time zone,
    resolution_note text
);


--
-- Name: allocation_log; Type: TABLE; Schema: agripump; Owner: -
--

CREATE TABLE agripump.allocation_log (
    id bigint NOT NULL,
    pump_id character varying(50) NOT NULL,
    from_user_id uuid,
    to_user_id uuid NOT NULL,
    actor_id uuid,
    note text,
    occurred_at timestamp with time zone
);


--
-- Name: allocation_log_id_seq; Type: SEQUENCE; Schema: agripump; Owner: -
--

CREATE SEQUENCE agripump.allocation_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: allocation_log_id_seq; Type: SEQUENCE OWNED BY; Schema: agripump; Owner: -
--

ALTER SEQUENCE agripump.allocation_log_id_seq OWNED BY agripump.allocation_log.id;


--
-- Name: audit_log; Type: TABLE; Schema: agripump; Owner: -
--

CREATE TABLE agripump.audit_log (
    id bigint NOT NULL,
    actor_id uuid,
    actor_role character varying(30),
    entity_type character varying(30) NOT NULL,
    entity_id character varying(50) NOT NULL,
    action character varying(30) NOT NULL,
    before_json jsonb,
    after_json jsonb,
    ip character varying(45),
    occurred_at timestamp with time zone
);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: agripump; Owner: -
--

CREATE SEQUENCE agripump.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: agripump; Owner: -
--

ALTER SEQUENCE agripump.audit_log_id_seq OWNED BY agripump.audit_log.id;


--
-- Name: batch_imeis; Type: TABLE; Schema: agripump; Owner: -
--

CREATE TABLE agripump.batch_imeis (
    id bigint NOT NULL,
    batch_id uuid NOT NULL,
    imei character varying(20) NOT NULL,
    mcu_uid character varying(30),
    claimed boolean,
    claimed_at timestamp with time zone,
    pump_id character varying(50),
    created_at timestamp with time zone
);


--
-- Name: batch_imeis_id_seq; Type: SEQUENCE; Schema: agripump; Owner: -
--

CREATE SEQUENCE agripump.batch_imeis_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: batch_imeis_id_seq; Type: SEQUENCE OWNED BY; Schema: agripump; Owner: -
--

ALTER SEQUENCE agripump.batch_imeis_id_seq OWNED BY agripump.batch_imeis.id;


--
-- Name: branding; Type: TABLE; Schema: agripump; Owner: -
--

CREATE TABLE agripump.branding (
    org_id uuid NOT NULL,
    theme_color character varying(20),
    logo_url text,
    sender_name character varying(50),
    subdomain character varying(50),
    updated_at timestamp with time zone
);


--
-- Name: commands; Type: TABLE; Schema: agripump; Owner: -
--

CREATE TABLE agripump.commands (
    cid uuid NOT NULL,
    pump_id character varying(50) NOT NULL,
    actor_id uuid,
    action character varying(10) NOT NULL,
    status character varying(20) NOT NULL,
    reject_reason character varying(50),
    issued_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    acked_at timestamp with time zone
);


--
-- Name: config_templates; Type: TABLE; Schema: agripump; Owner: -
--

CREATE TABLE agripump.config_templates (
    id uuid NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    desired_json jsonb,
    owner_user_id uuid,
    owner_hierarchy_path text,
    hp_rating numeric(4,1),
    supply_type character varying(20),
    config_json jsonb,
    created_by uuid,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: device_batches; Type: TABLE; Schema: agripump; Owner: -
--

CREATE TABLE agripump.device_batches (
    id uuid NOT NULL,
    batch_code character varying(50) NOT NULL,
    model character varying(100) NOT NULL,
    hw_rev character varying(20),
    quantity integer,
    manufacture_date date,
    created_by uuid,
    created_at timestamp with time zone,
    revoked boolean,
    revoked_at timestamp with time zone
);


--
-- Name: device_config; Type: TABLE; Schema: agripump; Owner: -
--

CREATE TABLE agripump.device_config (
    pump_id character varying(50) NOT NULL,
    desired_json jsonb NOT NULL,
    reported_json jsonb NOT NULL,
    status character varying(20) NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone
);


--
-- Name: fault_code_catalog; Type: TABLE; Schema: agripump; Owner: -
--

CREATE TABLE agripump.fault_code_catalog (
    code smallint NOT NULL,
    name character varying(50) NOT NULL,
    severity character varying(10) NOT NULL,
    description text
);


--
-- Name: fault_code_catalog_code_seq; Type: SEQUENCE; Schema: agripump; Owner: -
--

CREATE SEQUENCE agripump.fault_code_catalog_code_seq
    AS smallint
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fault_code_catalog_code_seq; Type: SEQUENCE OWNED BY; Schema: agripump; Owner: -
--

ALTER SEQUENCE agripump.fault_code_catalog_code_seq OWNED BY agripump.fault_code_catalog.code;


--
-- Name: fault_logs; Type: TABLE; Schema: agripump; Owner: -
--

CREATE TABLE agripump.fault_logs (
    id bigint NOT NULL,
    pump_id character varying(50) NOT NULL,
    fault_code smallint,
    fault_description text,
    v_ry numeric(6,2),
    v_yb numeric(6,2),
    v_br numeric(6,2),
    i_r numeric(6,2),
    i_y numeric(6,2),
    i_b numeric(6,2),
    occurred_at timestamp with time zone,
    resolved_at timestamp with time zone,
    ack_by_user_id uuid,
    ack_at timestamp with time zone
);


--
-- Name: fault_logs_id_seq; Type: SEQUENCE; Schema: agripump; Owner: -
--

CREATE SEQUENCE agripump.fault_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fault_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: agripump; Owner: -
--

ALTER SEQUENCE agripump.fault_logs_id_seq OWNED BY agripump.fault_logs.id;


--
-- Name: invites; Type: TABLE; Schema: agripump; Owner: -
--

CREATE TABLE agripump.invites (
    token character varying(64) NOT NULL,
    parent_user_id uuid NOT NULL,
    role character varying(20) NOT NULL,
    dealer_depth integer,
    created_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    redeemed_at timestamp with time zone
);


--
-- Name: otp_challenges; Type: TABLE; Schema: agripump; Owner: -
--

CREATE TABLE agripump.otp_challenges (
    phone_number character varying(20) NOT NULL,
    otp_code character varying(10) NOT NULL,
    attempts integer,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone
);


--
-- Name: panels; Type: TABLE; Schema: agripump; Owner: -
--

CREATE TABLE agripump.panels (
    id uuid NOT NULL,
    panel_serial character varying(100) NOT NULL,
    pump_id character varying(50),
    motor_hp numeric(4,1),
    starter_type character varying(50),
    ct_ratio integer,
    make_model character varying(100),
    created_at timestamp with time zone
);


--
-- Name: pumps; Type: TABLE; Schema: agripump; Owner: -
--

CREATE TABLE agripump.pumps (
    id character varying(50) NOT NULL,
    name character varying(100) NOT NULL,
    supply_type character varying(10),
    hp_rating numeric(4,1),
    owner_user_id uuid,
    installed_by_user_id uuid,
    hierarchy_path text NOT NULL,
    latitude numeric(10,6) NOT NULL,
    longitude numeric(10,6) NOT NULL,
    firmware_version character varying(20),
    status character varying(20),
    lifecycle_state character varying(20) NOT NULL,
    device_key_hash character varying(255),
    last_command_at timestamp with time zone,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone,
    warranty_start_date date,
    warranty_period_months integer,
    panel_serial character varying(50),
    motor_rating character varying(50),
    starter_type character varying(30),
    pump_make character varying(50),
    pump_model character varying(50)
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: agripump; Owner: -
--

CREATE TABLE agripump.refresh_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_hash character varying(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    replaced_by uuid,
    created_at timestamp with time zone
);


--
-- Name: telemetry_history; Type: TABLE; Schema: agripump; Owner: -
--

CREATE TABLE agripump.telemetry_history (
    id bigint NOT NULL,
    pump_id character varying(50) NOT NULL,
    v_ry numeric(6,2),
    v_yb numeric(6,2),
    v_br numeric(6,2),
    i_r numeric(6,2),
    i_y numeric(6,2),
    i_b numeric(6,2),
    pump_on boolean,
    fault_active boolean,
    gsm_rssi integer,
    seq bigint,
    ts_approx boolean,
    buffered boolean,
    recorded_at timestamp with time zone NOT NULL
);


--
-- Name: telemetry_history_id_seq; Type: SEQUENCE; Schema: agripump; Owner: -
--

CREATE SEQUENCE agripump.telemetry_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: telemetry_history_id_seq; Type: SEQUENCE OWNED BY; Schema: agripump; Owner: -
--

ALTER SEQUENCE agripump.telemetry_history_id_seq OWNED BY agripump.telemetry_history.id;


--
-- Name: users; Type: TABLE; Schema: agripump; Owner: -
--

CREATE TABLE agripump.users (
    id uuid NOT NULL,
    full_name character varying(100) NOT NULL,
    email character varying(255),
    phone character varying(20),
    password_hash character varying(255),
    role character varying(30) NOT NULL,
    hierarchy_path character varying(255) NOT NULL,
    is_active boolean NOT NULL,
    is_verified boolean NOT NULL,
    totp_secret character varying(64),
    totp_enabled boolean NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: allocation_log id; Type: DEFAULT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.allocation_log ALTER COLUMN id SET DEFAULT nextval('agripump.allocation_log_id_seq'::regclass);


--
-- Name: audit_log id; Type: DEFAULT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.audit_log ALTER COLUMN id SET DEFAULT nextval('agripump.audit_log_id_seq'::regclass);


--
-- Name: batch_imeis id; Type: DEFAULT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.batch_imeis ALTER COLUMN id SET DEFAULT nextval('agripump.batch_imeis_id_seq'::regclass);


--
-- Name: fault_code_catalog code; Type: DEFAULT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.fault_code_catalog ALTER COLUMN code SET DEFAULT nextval('agripump.fault_code_catalog_code_seq'::regclass);


--
-- Name: fault_logs id; Type: DEFAULT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.fault_logs ALTER COLUMN id SET DEFAULT nextval('agripump.fault_logs_id_seq'::regclass);


--
-- Name: telemetry_history id; Type: DEFAULT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.telemetry_history ALTER COLUMN id SET DEFAULT nextval('agripump.telemetry_history_id_seq'::regclass);


--
-- Name: alert_subscriptions alert_subscriptions_pkey; Type: CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.alert_subscriptions
    ADD CONSTRAINT alert_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: alerts alerts_pkey; Type: CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.alerts
    ADD CONSTRAINT alerts_pkey PRIMARY KEY (id);


--
-- Name: allocation_log allocation_log_pkey; Type: CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.allocation_log
    ADD CONSTRAINT allocation_log_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: batch_imeis batch_imeis_imei_key; Type: CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.batch_imeis
    ADD CONSTRAINT batch_imeis_imei_key UNIQUE (imei);


--
-- Name: batch_imeis batch_imeis_pkey; Type: CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.batch_imeis
    ADD CONSTRAINT batch_imeis_pkey PRIMARY KEY (id);


--
-- Name: branding branding_pkey; Type: CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.branding
    ADD CONSTRAINT branding_pkey PRIMARY KEY (org_id);


--
-- Name: commands commands_pkey; Type: CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.commands
    ADD CONSTRAINT commands_pkey PRIMARY KEY (cid);


--
-- Name: config_templates config_templates_pkey; Type: CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.config_templates
    ADD CONSTRAINT config_templates_pkey PRIMARY KEY (id);


--
-- Name: device_batches device_batches_batch_code_key; Type: CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.device_batches
    ADD CONSTRAINT device_batches_batch_code_key UNIQUE (batch_code);


--
-- Name: device_batches device_batches_pkey; Type: CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.device_batches
    ADD CONSTRAINT device_batches_pkey PRIMARY KEY (id);


--
-- Name: device_config device_config_pkey; Type: CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.device_config
    ADD CONSTRAINT device_config_pkey PRIMARY KEY (pump_id);


--
-- Name: fault_code_catalog fault_code_catalog_name_key; Type: CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.fault_code_catalog
    ADD CONSTRAINT fault_code_catalog_name_key UNIQUE (name);


--
-- Name: fault_code_catalog fault_code_catalog_pkey; Type: CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.fault_code_catalog
    ADD CONSTRAINT fault_code_catalog_pkey PRIMARY KEY (code);


--
-- Name: fault_logs fault_logs_pkey; Type: CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.fault_logs
    ADD CONSTRAINT fault_logs_pkey PRIMARY KEY (id);


--
-- Name: invites invites_pkey; Type: CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.invites
    ADD CONSTRAINT invites_pkey PRIMARY KEY (token);


--
-- Name: otp_challenges otp_challenges_pkey; Type: CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.otp_challenges
    ADD CONSTRAINT otp_challenges_pkey PRIMARY KEY (phone_number);


--
-- Name: panels panels_panel_serial_key; Type: CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.panels
    ADD CONSTRAINT panels_panel_serial_key UNIQUE (panel_serial);


--
-- Name: panels panels_pkey; Type: CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.panels
    ADD CONSTRAINT panels_pkey PRIMARY KEY (id);


--
-- Name: pumps pumps_pkey; Type: CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.pumps
    ADD CONSTRAINT pumps_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: telemetry_history telemetry_history_pkey; Type: CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.telemetry_history
    ADD CONSTRAINT telemetry_history_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: ix_agripump_users_email; Type: INDEX; Schema: agripump; Owner: -
--

CREATE UNIQUE INDEX ix_agripump_users_email ON agripump.users USING btree (email);


--
-- Name: ix_agripump_users_phone; Type: INDEX; Schema: agripump; Owner: -
--

CREATE UNIQUE INDEX ix_agripump_users_phone ON agripump.users USING btree (phone);


--
-- Name: alert_subscriptions alert_subscriptions_pump_id_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.alert_subscriptions
    ADD CONSTRAINT alert_subscriptions_pump_id_fkey FOREIGN KEY (pump_id) REFERENCES agripump.pumps(id) ON DELETE CASCADE;


--
-- Name: alert_subscriptions alert_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.alert_subscriptions
    ADD CONSTRAINT alert_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES agripump.users(id) ON DELETE CASCADE;


--
-- Name: alerts alerts_acknowledged_by_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.alerts
    ADD CONSTRAINT alerts_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES agripump.users(id) ON DELETE SET NULL;


--
-- Name: alerts alerts_assigned_to_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.alerts
    ADD CONSTRAINT alerts_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES agripump.users(id) ON DELETE SET NULL;


--
-- Name: alerts alerts_fault_code_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.alerts
    ADD CONSTRAINT alerts_fault_code_fkey FOREIGN KEY (fault_code) REFERENCES agripump.fault_code_catalog(code);


--
-- Name: alerts alerts_pump_id_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.alerts
    ADD CONSTRAINT alerts_pump_id_fkey FOREIGN KEY (pump_id) REFERENCES agripump.pumps(id) ON DELETE CASCADE;


--
-- Name: alerts alerts_source_fault_log_id_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.alerts
    ADD CONSTRAINT alerts_source_fault_log_id_fkey FOREIGN KEY (source_fault_log_id) REFERENCES agripump.fault_logs(id) ON DELETE SET NULL;


--
-- Name: allocation_log allocation_log_actor_id_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.allocation_log
    ADD CONSTRAINT allocation_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES agripump.users(id) ON DELETE SET NULL;


--
-- Name: allocation_log allocation_log_from_user_id_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.allocation_log
    ADD CONSTRAINT allocation_log_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES agripump.users(id) ON DELETE SET NULL;


--
-- Name: allocation_log allocation_log_pump_id_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.allocation_log
    ADD CONSTRAINT allocation_log_pump_id_fkey FOREIGN KEY (pump_id) REFERENCES agripump.pumps(id) ON DELETE CASCADE;


--
-- Name: allocation_log allocation_log_to_user_id_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.allocation_log
    ADD CONSTRAINT allocation_log_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES agripump.users(id) ON DELETE CASCADE;


--
-- Name: audit_log audit_log_actor_id_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.audit_log
    ADD CONSTRAINT audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES agripump.users(id) ON DELETE SET NULL;


--
-- Name: batch_imeis batch_imeis_batch_id_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.batch_imeis
    ADD CONSTRAINT batch_imeis_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES agripump.device_batches(id) ON DELETE CASCADE;


--
-- Name: batch_imeis batch_imeis_pump_id_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.batch_imeis
    ADD CONSTRAINT batch_imeis_pump_id_fkey FOREIGN KEY (pump_id) REFERENCES agripump.pumps(id) ON DELETE SET NULL;


--
-- Name: branding branding_org_id_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.branding
    ADD CONSTRAINT branding_org_id_fkey FOREIGN KEY (org_id) REFERENCES agripump.users(id) ON DELETE CASCADE;


--
-- Name: commands commands_actor_id_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.commands
    ADD CONSTRAINT commands_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES agripump.users(id) ON DELETE SET NULL;


--
-- Name: commands commands_pump_id_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.commands
    ADD CONSTRAINT commands_pump_id_fkey FOREIGN KEY (pump_id) REFERENCES agripump.pumps(id) ON DELETE CASCADE;


--
-- Name: config_templates config_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.config_templates
    ADD CONSTRAINT config_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES agripump.users(id);


--
-- Name: config_templates config_templates_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.config_templates
    ADD CONSTRAINT config_templates_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES agripump.users(id);


--
-- Name: device_batches device_batches_created_by_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.device_batches
    ADD CONSTRAINT device_batches_created_by_fkey FOREIGN KEY (created_by) REFERENCES agripump.users(id);


--
-- Name: device_config device_config_pump_id_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.device_config
    ADD CONSTRAINT device_config_pump_id_fkey FOREIGN KEY (pump_id) REFERENCES agripump.pumps(id) ON DELETE CASCADE;


--
-- Name: device_config device_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.device_config
    ADD CONSTRAINT device_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES agripump.users(id);


--
-- Name: fault_logs fault_logs_ack_by_user_id_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.fault_logs
    ADD CONSTRAINT fault_logs_ack_by_user_id_fkey FOREIGN KEY (ack_by_user_id) REFERENCES agripump.users(id);


--
-- Name: fault_logs fault_logs_fault_code_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.fault_logs
    ADD CONSTRAINT fault_logs_fault_code_fkey FOREIGN KEY (fault_code) REFERENCES agripump.fault_code_catalog(code);


--
-- Name: fault_logs fault_logs_pump_id_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.fault_logs
    ADD CONSTRAINT fault_logs_pump_id_fkey FOREIGN KEY (pump_id) REFERENCES agripump.pumps(id) ON DELETE CASCADE;


--
-- Name: invites invites_parent_user_id_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.invites
    ADD CONSTRAINT invites_parent_user_id_fkey FOREIGN KEY (parent_user_id) REFERENCES agripump.users(id) ON DELETE CASCADE;


--
-- Name: panels panels_pump_id_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.panels
    ADD CONSTRAINT panels_pump_id_fkey FOREIGN KEY (pump_id) REFERENCES agripump.pumps(id) ON DELETE SET NULL;


--
-- Name: pumps pumps_installed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.pumps
    ADD CONSTRAINT pumps_installed_by_user_id_fkey FOREIGN KEY (installed_by_user_id) REFERENCES agripump.users(id) ON DELETE SET NULL;


--
-- Name: pumps pumps_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.pumps
    ADD CONSTRAINT pumps_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES agripump.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_replaced_by_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.refresh_tokens
    ADD CONSTRAINT refresh_tokens_replaced_by_fkey FOREIGN KEY (replaced_by) REFERENCES agripump.refresh_tokens(id) ON DELETE SET NULL;


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES agripump.users(id) ON DELETE CASCADE;


--
-- Name: telemetry_history telemetry_history_pump_id_fkey; Type: FK CONSTRAINT; Schema: agripump; Owner: -
--

ALTER TABLE ONLY agripump.telemetry_history
    ADD CONSTRAINT telemetry_history_pump_id_fkey FOREIGN KEY (pump_id) REFERENCES agripump.pumps(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


