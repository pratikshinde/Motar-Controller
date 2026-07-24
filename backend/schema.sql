-- ============================================================================
-- IoT Agricultural & Domestic Water Pump Monitoring Ecosystem
-- PostgreSQL Database Schema with 9-Tier Path Enumeration
-- Schema: agripump (Isolated inside propcb database)
-- ============================================================================

-- Create isolated agripump schema
CREATE SCHEMA IF NOT EXISTS agripump;
SET search_path TO agripump, public;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;

-- Optional PostGIS extension block (graceful fallback if PostGIS bundle is not installed)
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PostGIS extension not available on this PostgreSQL instance. Using standard numeric lat/lng columns.';
END $$;

-- ----------------------------------------------------------------------------
-- 1. USERS & 9-TIER HIERARCHY TABLE WITH AUTH CREDENTIALS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agripump.users (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    full_name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20) UNIQUE NOT NULL, -- E.164 format (+919876543210)
    email VARCHAR(100),
    password_hash VARCHAR(255), -- Securely hashed password for admin accounts
    role VARCHAR(30) NOT NULL CHECK (
        role IN (
            'superadmin', 'manufacturer', 'distributor', 
            'dealer1', 'dealer2', 'dealer3', 'dealer4', 'dealer5', 'customer'
        )
    ),
    -- Path Enumeration String for O(1) Hierarchy Tree Scoping
    hierarchy_path TEXT NOT NULL,
    parent_user_id UUID REFERENCES agripump.users(id) ON DELETE SET NULL,
    preferred_language VARCHAR(10) DEFAULT 'en',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Ensure password_hash column exists on existing installations
ALTER TABLE agripump.users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

-- Index for fast path enumeration descendant lookup
CREATE INDEX IF NOT EXISTS idx_users_hierarchy_path ON agripump.users (hierarchy_path text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_users_phone ON agripump.users (phone_number);

-- ----------------------------------------------------------------------------
-- 2. OTP CHALLENGE STATE TABLE (REAL MOBILE AUTHENTICATION)
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
-- 3. PUMPS & DEVICE REGISTRY TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agripump.pumps (
    id VARCHAR(50) PRIMARY KEY, -- Device Thing Name: e.g. "PUMP-4G-3P-8821"
    name VARCHAR(100) NOT NULL, -- Human name: "Borewell Pump #1"
    supply_type VARCHAR(10) NOT NULL CHECK (supply_type IN ('3-phase', '1-phase')),
    hp_rating NUMERIC(4, 1) DEFAULT 7.5,
    
    owner_user_id UUID NOT NULL REFERENCES agripump.users(id) ON DELETE CASCADE,
    installed_by_user_id UUID REFERENCES agripump.users(id) ON DELETE SET NULL,
    hierarchy_path TEXT NOT NULL, -- Inherited from owner for fast tree querying
    
    latitude NUMERIC(10, 6) NOT NULL,
    longitude NUMERIC(10, 6) NOT NULL,
    
    firmware_version VARCHAR(20) DEFAULT 'v2.4.1',
    status VARCHAR(20) DEFAULT 'STOPPED' CHECK (status IN ('RUNNING', 'STOPPED', 'FAULT')),
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for location and path queries
CREATE INDEX IF NOT EXISTS idx_pumps_lat_lng ON agripump.pumps (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_pumps_hierarchy_path ON agripump.pumps (hierarchy_path text_pattern_ops);

-- ----------------------------------------------------------------------------
-- 4. TELEMETRY HISTORY TABLE
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
    
    power_factor NUMERIC(3, 2) DEFAULT 0.88,
    frequency NUMERIC(4, 1) DEFAULT 50.0,
    gsm_rssi INT DEFAULT 24,
    
    pump_on BOOLEAN DEFAULT FALSE,
    fault_active BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_telemetry_pump_time ON agripump.telemetry_history (pump_id, recorded_at DESC);

-- ----------------------------------------------------------------------------
-- 5. FAULT INCIDENT & PROTECTION LOGS TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agripump.fault_logs (
    id BIGSERIAL PRIMARY KEY,
    pump_id VARCHAR(50) NOT NULL REFERENCES agripump.pumps(id) ON DELETE CASCADE,
    occurred_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    fault_code VARCHAR(30) NOT NULL, -- 'ERR_PHASE_LOSS', 'ERR_OVERLOAD', 'ERR_DRY_RUN', etc.
    description TEXT NOT NULL,
    v_yb_snapshot NUMERIC(5, 1),
    contactor_tripped BOOLEAN DEFAULT TRUE,
    alert_sent_sms BOOLEAN DEFAULT FALSE,
    alert_sent_whatsapp BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_fault_logs_pump ON agripump.fault_logs (pump_id, occurred_at DESC);

-- ----------------------------------------------------------------------------
-- SAMPLE INITIAL SEED DATA WITH SAMPLE PASSWORDS
-- ----------------------------------------------------------------------------
INSERT INTO agripump.users (id, full_name, phone_number, role, hierarchy_path, preferred_language, password_hash)
VALUES 
  ('11111111-1111-1111-1111-111111111111', 'Superadmin Platform', '+919900000000', 'superadmin', '11111111-1111-1111-1111-111111111111', 'en', '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918'), -- admin123
  ('22222222-2222-2222-2222-222222222222', 'Ramesh Patel (Farmer)', '+919741323830', 'customer', '11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222', 'hi', NULL)
ON CONFLICT (id) DO UPDATE SET phone_number = EXCLUDED.phone_number, password_hash = EXCLUDED.password_hash;

INSERT INTO agripump.pumps (id, name, supply_type, hp_rating, owner_user_id, hierarchy_path, latitude, longitude, status)
VALUES 
  ('PUMP-4G-3P-8821', 'Borewell Pump #1', '3-phase', 15.0, '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222', 19.9975, 73.7898, 'RUNNING'),
  ('PUMP-4G-3P-4412', 'Canal Pump #2', '3-phase', 7.5, '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222', 20.0050, 73.7620, 'FAULT')
ON CONFLICT (id) DO NOTHING;
