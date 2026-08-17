const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { sendDltSms, sendWhatsAppAlert } = require('./services/notificationService');
const { signToken, verifyToken, generateRefreshToken, hashRefreshToken, ACCESS_TOKEN_TTL_SECONDS } = require('./services/jwtAuth');
const { hashSecret, verifySecret } = require('./services/secretHash');
const { authenticateToken, requireRole, authenticateDevice } = require('./middleware/authMiddleware');
const { rateLimit, keyByIpAndBody } = require('./middleware/rateLimiter');
const { attachWebSocketServer, broadcastPumpUpdate, broadcastFault, broadcastConfigUpdate } = require('./services/wsHub');
const { generateSecret, verifyTotp, buildOtpauthUrl } = require('./services/totp');
const { raiseAlert, deliverAlert, runOfflineSweep } = require('./services/alertEngine');
const metrics = require('./services/metrics');

const app = express();

// CORS configuration - DEFAULT DENY (Strict Opt-in for Development)
// Port 3000 is the Vite dev server (web/vite.config.ts) — the frontend
// moved from a single file served same-origin at :5000 to a React app
// served by Vite in dev, so cross-origin requests to the API are now the
// normal case rather than something only NODE_ENV=development allows.
const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',')
  : ['http://localhost:5000', 'http://127.0.0.1:5000', 'http://localhost:3000', 'http://127.0.0.1:3000'];

const isDevEnvironment = process.env.NODE_ENV === 'development';

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || isDevEnvironment) {
      callback(null, true);
    } else {
      callback(new Error('CORS Policy Error: Origin not allowed'));
    }
  },
  credentials: true
}));

app.use(express.json());

// FR-WEB-017 — every response actually sent is counted here, bucketed by
// status code. This is the only source for the request/error counts on
// GET /api/system/health; nothing about it is estimated.
app.use((req, res, next) => {
  metrics.increment('http_requests_total');
  res.on('finish', () => {
    if (res.statusCode >= 500) metrics.increment('http_errors_5xx');
    else if (res.statusCode >= 400) metrics.increment('http_errors_4xx');
  });
  next();
});

// Serve static frontend files from web/ folder
app.use(express.static(path.join(__dirname, '../web')));

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || 'propcb',
  password: process.env.PGPASSWORD || 'propcb_dev_password',
  database: process.env.PGDATABASE || 'propcb',
});

// Made reachable to middleware (authenticateDevice) via req.app.get('pgPool')
app.set('pgPool', pool);

// Set default schema search_path on connect
pool.on('connect', (client) => {
  client.query('SET search_path TO agripump, public');
});

// Test DB Connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('⚠️ PostgreSQL Connection Error:', err.message);
  } else {
    console.log('✅ Connected to local PostgreSQL database: propcb (schema: agripump)');
    release();
  }
});

const ROOT_HIERARCHY_PATH = '11111111-1111-1111-1111-111111111111';
const COMMAND_COOLDOWN_SECONDS = 45;
const COMMAND_EXPIRY_SECONDS = 120;

// ----------------------------------------------------------------------------
// Hierarchy / role helpers (SRS §7 — dealer hierarchy collapsed to a single
// 'dealer' role with a computed depth; see schema.sql v2 header)
// ----------------------------------------------------------------------------
const ASSIGNABLE_ROLES = {
  superadmin: ['superadmin', 'manufacturer', 'distributor', 'dealer', 'customer'],
  manufacturer: ['distributor', 'dealer', 'customer'],
  distributor: ['dealer', 'customer'],
  dealer: ['dealer', 'customer'],
};

function canAssignRole(creatorRole, targetRole) {
  return (ASSIGNABLE_ROLES[creatorRole] || []).includes(targetRole);
}

async function computeDealerDepth(client, parentUserId, targetRole) {
  if (targetRole !== 'dealer') return 0;
  if (!parentUserId) return 1;
  const r = await client.query(`SELECT role, dealer_depth FROM agripump.users WHERE id = $1`, [parentUserId]);
  if (r.rows.length === 0) return 1;
  const parent = r.rows[0];
  return parent.role === 'dealer' ? parent.dealer_depth + 1 : 1;
}

/**
 * Fetch a pump only if it is within the caller's scope: superadmin sees
 * everything; everyone else only sees pumps whose hierarchy_path falls
 * under their own (same LIKE-prefix rule GET /api/pumps already used).
 * Returns null (not a thrown error) when the pump doesn't exist OR is out
 * of scope, deliberately not distinguishing the two to a non-superadmin
 * caller — a 404 for "not yours" leaks less than a 403 would.
 */
async function getPumpInScope(client, pumpId, user) {
  const result = await client.query(`SELECT * FROM agripump.pumps WHERE id = $1`, [pumpId]);
  if (result.rows.length === 0) return null;
  const pump = result.rows[0];
  if (user.role === 'superadmin') return pump;
  const userPath = user.hierarchy_path || ROOT_HIERARCHY_PATH;
  if (!pump.hierarchy_path.startsWith(userPath)) return null;
  if (user.role === 'customer' && pump.owner_user_id !== user.id) return null;
  return pump;
}

/**
 * Same shape as a GET /api/pumps row (id/status/latest telemetry via the
 * W0 LATERAL join) for exactly one pump — used to build WebSocket
 * pump_update payloads so the frontend's merge-by-id logic doesn't need a
 * second, REST-shaped type for live updates.
 */
async function fetchPumpBroadcastRow(client, pumpId) {
  const result = await client.query(
    `SELECT p.id, p.name, p.supply_type, p.hp_rating, p.latitude, p.longitude,
            p.status, p.lifecycle_state, p.firmware_version, p.last_seen_at, p.hierarchy_path,
            t.v_ry, t.v_yb, t.v_br, t.i_r, t.i_y, t.i_b, t.gsm_rssi,
            t.recorded_at AS telemetry_recorded_at, t.ts_approx, t.buffered
     FROM agripump.pumps p
     LEFT JOIN LATERAL (
       SELECT v_ry, v_yb, v_br, i_r, i_y, i_b, gsm_rssi, recorded_at, ts_approx, buffered
       FROM agripump.telemetry_history th
       WHERE th.pump_id = p.id
       ORDER BY th.recorded_at DESC
       LIMIT 1
     ) t ON true
     WHERE p.id = $1`,
    [pumpId]
  );
  return result.rows[0] || null;
}

/** Strip fields that must never leave the server (the device key's salted
 * hash is safe at rest but has no reason to appear in an API response). */
function sanitizePump(pump) {
  if (!pump) return pump;
  const { device_key_hash, ...rest } = pump;
  return rest;
}

async function writeAudit(client, { actorId, actorRole, entityType, entityId, action, before = null, after = null, ip = null }) {
  try {
    await client.query(
      `INSERT INTO agripump.audit_log (actor_id, actor_role, entity_type, entity_id, action, before_json, after_json, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [actorId, actorRole, entityType, entityId, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, ip]
    );
  } catch (err) {
    // Audit logging must never break the primary operation it's recording.
    console.error('⚠️ Failed to write audit log entry:', err.message);
  }
}

/** Standard Luhn check-digit validation for a 15-digit IMEI (the same
 * algorithm handsets/modems use to generate the trailing check digit). A
 * value that is merely 15 digits but fails this isn't a real IMEI — worth
 * catching at import time rather than letting a typo into the whitelist. */
function isValidImei(imei) {
  if (!/^\d{15}$/.test(imei)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let digit = parseInt(imei[14 - i], 10);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** Parses the pasted/CSV IMEI whitelist text for POST /api/batches/:id/imeis.
 * One entry per line, optionally "imei,mcu_uid", optionally with a header
 * row starting with "imei" (case-insensitive) which is skipped. Returns
 * {imei, mcuUid, rowNumber} for every non-blank line — validation happens
 * at the call site so it can also check cross-row/DB duplicates. */
function parseImeiUpload(raw) {
  const lines = String(raw || '').split(/\r?\n/);
  const rows = [];
  let rowNumber = 0;
  for (const line of lines) {
    rowNumber++;
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (rowNumber === 1 && /^imei\b/i.test(trimmed)) continue;
    const parts = trimmed.split(',');
    rows.push({
      rowNumber,
      imei: (parts[0] || '').trim(),
      mcuUid: parts[1] ? parts[1].trim() : null
    });
  }
  return rows;
}

async function issueTokenPair(client, userRecord) {
  const accessToken = signToken({
    id: userRecord.id,
    phone_number: userRecord.phone_number,
    role: userRecord.role,
    hierarchy_path: userRecord.hierarchy_path,
    totp_enabled: Boolean(userRecord.totp_enabled)
  });

  const { raw, hash, expiresAt } = generateRefreshToken();
  await client.query(
    `INSERT INTO agripump.refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userRecord.id, hash, expiresAt]
  );

  return { accessToken, refreshToken: raw, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

// FR-WEB-001: MFA is mandatory for Superadmin and panel-manufacturer Owner
// roles. The schema doesn't yet distinguish an Owner sub-role within
// 'manufacturer' (that's the P-1 multi-staff org_role work, not landed —
// Web_App_Pending_Items.md §8.1.2), so this applies to the whole
// 'manufacturer' role as the closest faithful approximation today.
const MFA_REQUIRED_ROLES = ['superadmin', 'manufacturer'];
const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;

/**
 * Shared tail end of every login path (OTP, password, and the MFA-verify
 * step itself): if the account has TOTP enabled, don't issue real tokens
 * yet — issue a short-lived, privilege-free mfa_token instead and make
 * the caller complete POST /api/auth/mfa/verify. Otherwise issue the real
 * pair, flagging mfa_setup_required if this account's role requires MFA
 * but hasn't configured it — the frontend turns that into a blocking
 * "set up MFA now" step rather than a silent gap.
 */
async function finishAuth(res, userRecord, message) {
  // FR-WEB-012 — a suspended account (manufacturer org paused, or any
  // other subordinate) is blocked at the point tokens would be issued,
  // not just hidden from the UI. Checked here rather than per-caller so
  // every login path (OTP, password, MFA-verify) enforces it the same way.
  if (userRecord.account_status === 'SUSPENDED') {
    return res.status(403).json({ error: 'This account has been suspended. Contact your administrator.' });
  }
  if (userRecord.totp_enabled) {
    const mfaToken = signToken({ mfaPending: userRecord.id }, MFA_CHALLENGE_TTL_SECONDS);
    return res.json({ mfa_required: true, mfa_token: mfaToken, expiresIn: MFA_CHALLENGE_TTL_SECONDS });
  }

  const { accessToken, refreshToken, expiresIn } = await issueTokenPair(pool, userRecord);
  res.json({
    message,
    token: accessToken,
    refreshToken,
    expiresIn,
    mfa_setup_required: MFA_REQUIRED_ROLES.includes(userRecord.role),
    user: {
      id: userRecord.id,
      full_name: userRecord.full_name,
      phone_number: userRecord.phone_number,
      role: userRecord.role,
      hierarchy_path: userRecord.hierarchy_path,
      totp_enabled: Boolean(userRecord.totp_enabled)
    }
  });
}

// ----------------------------------------------------------------------------
// ROOT HEALTH CHECK & API SITEMAP
// ----------------------------------------------------------------------------
app.get('/api', (req, res) => {
  res.json({
    status: 'ONLINE',
    system: 'AgriPump SmartSpace IoT REST API',
    database: 'PostgreSQL propcb (schema: agripump)',
    endpoints: {
      sendOtp: 'POST /api/auth/send-otp',
      verifyOtp: 'POST /api/auth/verify-otp',
      loginPassword: 'POST /api/auth/login-password',
      refresh: 'POST /api/auth/refresh',
      logout: 'POST /api/auth/logout (Authenticated)',
      mfaSetup: 'POST /api/auth/mfa/setup (Authenticated)',
      mfaEnable: 'POST /api/auth/mfa/enable (Authenticated)',
      mfaDisable: 'POST /api/auth/mfa/disable (Authenticated)',
      mfaVerify: 'POST /api/auth/mfa/verify (second step of login when the account has MFA enabled)',
      getFleetDashboard: 'GET /api/fleet/dashboard (Authenticated, scoped — FR-WEB-014)',
      getServiceReports: 'GET /api/service-reports?days=30 (Authenticated, scoped — fault frequency/MTBF/runtime/uptime per device, FR-WEB-037)',
      getPumpServiceReport: 'GET /api/pumps/:id/service-report?days=30 (Authenticated, scoped — FR-WEB-037)',
      getSystemHealth: 'GET /api/system/health (Superadmin Only — FR-WEB-017)',
      getPumps: 'GET /api/pumps?hierarchy_path=...&page=1&limit=50&search=...',
      setLifecycle: 'POST /api/pumps/:id/lifecycle (Authenticated, scoped, server-enforced state machine — FR-SEC-010)',
      createBatch: 'POST /api/batches (Superadmin Only — FR-WEB-010/011)',
      getBatches: 'GET /api/batches (Superadmin Only)',
      getBatchDetail: 'GET /api/batches/:id (Superadmin Only)',
      importBatchImeis: 'POST /api/batches/:id/imeis (Superadmin Only — CSV/paste whitelist import with per-row validation, C-1)',
      revokeBatch: 'POST /api/batches/:id/revoke (Superadmin Only)',
      bulkAllocate: 'POST /api/pumps/bulk-allocate (Authenticated, scoped — FR-WEB-013/030)',
      getPumpDetail: 'GET /api/pumps/:id (Authenticated, scoped)',
      getPumpProvenance: 'GET /api/pumps/:id/provenance (Authenticated, scoped — ownership/allocation history/warranty/batch origin)',
      setPumpWarranty: 'PUT /api/pumps/:id/warranty (Superadmin Only)',
      setPanelBinding: 'PUT /api/pumps/:id/panel (Authenticated, scoped — FR-WEB-031)',
      getMcuSwapHistory: 'GET /api/pumps/:id/mcu-swap-history (Authenticated, scoped — FR-WEB-034)',
      mcuSwap: 'POST /api/pumps/:id/mcu-swap (Authenticated, scoped)',
      bridgeSwap: 'POST /api/pumps/:id/bridge-swap (Superadmin Only — identity migration)',
      createConfigTemplate: 'POST /api/config-templates (Authenticated, scoped — FR-WEB-032)',
      getConfigTemplates: 'GET /api/config-templates (Authenticated, scoped)',
      updateConfigTemplate: 'PUT /api/config-templates/:id (Authenticated, scoped)',
      deleteConfigTemplate: 'DELETE /api/config-templates/:id (Authenticated, scoped)',
      applyConfigTemplate: 'POST /api/config-templates/:id/apply (Authenticated, scoped — merges into each target)',
      createPump: 'POST /api/pumps (Superadmin Only)',
      updateLocation: 'POST /api/pumps/:id/location (Superadmin Only)',
      deletePump: 'DELETE /api/pumps/:id (Superadmin Only)',
      dispatchCommand: 'POST /api/pumps/:id/command (Authenticated, scoped, server-enforced 45s cooldown)',
      getTelemetryHistory: 'GET /api/pumps/:id/telemetry?limit=200 (Authenticated, scoped)',
      getFaultLogs: 'GET /api/pumps/:id/faults (Authenticated, scoped)',
      ackFault: 'POST /api/pumps/:id/faults/:faultId/ack (Authenticated, scoped)',
      getAlerts: 'GET /api/alerts?status=open|acknowledged|resolved&severity=&pump_id= (Authenticated, scoped — FR-WEB-060/062/063)',
      ackAlert: 'POST /api/alerts/:id/ack (Authenticated, scoped)',
      assignAlert: 'POST /api/alerts/:id/assign (Authenticated, scoped)',
      resolveAlert: 'POST /api/alerts/:id/resolve (Authenticated, scoped)',
      getAlertSubscriptions: 'GET /api/alert-subscriptions (Authenticated — own subscriptions)',
      createAlertSubscription: 'POST /api/alert-subscriptions (Authenticated — own subscriptions)',
      deleteAlertSubscription: 'DELETE /api/alert-subscriptions/:id (Authenticated — own subscriptions)',
      getConfig: 'GET /api/pumps/:id/config (Authenticated, scoped)',
      setConfig: 'PUT /api/pumps/:id/config (Authenticated, scoped)',
      ingestTelemetry: 'POST /api/telemetry (Device-authenticated via X-Device-Key)',
      getPendingCommands: 'GET /api/devices/:id/commands/pending (Device-authenticated)',
      ackCommand: 'POST /api/devices/:id/commands/:cid/ack (Device-authenticated)',
      reportConfig: 'POST /api/devices/:id/config/report (Device-authenticated)',
      createSubordinateUser: 'POST /api/users (membership: subordinate | staff — P-1)',
      createInvite: 'POST /api/invites (Authenticated, role-scoped — FR-WEB-035)',
      redeemInvite: 'POST /api/invites/:token/redeem (Public, single-use, rate-limited)',
      resolveBranding: 'GET /api/branding/resolve (Authenticated — nearest-ancestor lookup, FR-WEB-036)',
      getMyBranding: 'GET /api/branding/mine (Manufacturer Only)',
      setMyBranding: 'PUT /api/branding/mine (Manufacturer Only)',
      getUserBranding: 'GET /api/branding/:userId (Superadmin Only)',
      setUserBranding: 'PUT /api/branding/:userId (Superadmin Only — target must be manufacturer role)',
      updateUser: 'PUT /api/users/:id (Superadmin — FR-WEB-012)',
      deleteUser: 'DELETE /api/users/:id (Superadmin — FR-WEB-012)',
      getUserTree: 'GET /api/users/tree (Authenticated, scoped, groups staff by org unit)',
      getAuditLog: 'GET /api/audit-log (Authenticated, scoped)',
      sendAlerts: 'POST /api/alerts/send (Authenticated)'
    },
    websocket: `ws://<host>/ws?token=<access_token> (FR-WEB-005 — live pump_update/fault/config_update push, tenant-scoped)`
  });
});

// ----------------------------------------------------------------------------
// 0A. POST /api/auth/send-otp: Generate & Dispatch 6-Digit Mobile SMS OTP
// ----------------------------------------------------------------------------
app.post(
  '/api/auth/send-otp',
  rateLimit({ windowMs: 5 * 60 * 1000, max: 5, keyFn: keyByIpAndBody('phone_number') }),
  async (req, res) => {
  try {
    const { phone_number } = req.body;
    if (!phone_number) {
      return res.status(400).json({ error: 'Mobile phone number is required' });
    }

    const cleanPhone = phone_number.trim().replace(/\s+/g, '');
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Upsert OTP challenge into database with 5-minute expiration
    await pool.query(
      `INSERT INTO agripump.otp_challenges (phone_number, otp_code, expires_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '5 minutes')
       ON CONFLICT (phone_number) DO UPDATE SET
         otp_code = EXCLUDED.otp_code,
         expires_at = EXCLUDED.expires_at,
         attempts = 0,
         created_at = CURRENT_TIMESTAMP`,
      [cleanPhone, otpCode]
    );

    // Dispatch OTP via live DLT SMS / mock gateway
    const smsResult = await sendDltSms(cleanPhone, 'SINGLE_PHASING', [otpCode], 'hi');

    console.log(`🔐 [AUTH OTP GENERATED] Phone: ${cleanPhone} | OTP Code: ${otpCode} (Expires in 5m)`);

    res.json({
      message: 'OTP challenge generated and dispatched',
      phone_number: cleanPhone,
      sms: smsResult,
      // Default-Deny: Only expose dev_otp when NODE_ENV is explicitly set to 'development'
      dev_otp: isDevEnvironment ? otpCode : undefined
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 0B. POST /api/auth/verify-otp: Verify Mobile OTP Challenge & Issue Tokens
//
// SEC-3 FIX: this endpoint used to accept a `role` field from the request
// body and grant it to a newly auto-provisioned account — including
// 'superadmin'. Any unregistered phone number could self-assign any role.
// It no longer reads `role` from the body at all: every auto-provisioned
// account is a 'customer', full stop. Elevated roles can only be granted by
// an existing superior via POST /api/users.
// ----------------------------------------------------------------------------
app.post(
  '/api/auth/verify-otp',
  rateLimit({ windowMs: 5 * 60 * 1000, max: 10, keyFn: keyByIpAndBody('phone_number') }),
  async (req, res) => {
  try {
    const { phone_number, otp_code } = req.body;
    if (!phone_number || !otp_code) {
      return res.status(400).json({ error: 'phone_number and otp_code are required' });
    }

    const cleanPhone = phone_number.trim().replace(/\s+/g, '');

    // Verify active OTP challenge in agripump.otp_challenges
    const challengeRes = await pool.query(
      `SELECT phone_number, otp_code, expires_at, attempts FROM agripump.otp_challenges
       WHERE phone_number = $1 AND expires_at > CURRENT_TIMESTAMP`,
      [cleanPhone]
    );

    if (challengeRes.rows.length === 0) {
      return res.status(401).json({ error: 'Authentication Failed: OTP code has expired or was not requested. Please request a new OTP.' });
    }

    const challenge = challengeRes.rows[0];

    // Enforce Maximum 5 Attempts Brute-Force Rate Limit
    if (challenge.attempts >= 5) {
      await pool.query(`DELETE FROM agripump.otp_challenges WHERE phone_number = $1`, [cleanPhone]);
      return res.status(429).json({ error: 'Too Many Failed Verification Attempts: OTP challenge invalidated for security. Please request a new OTP.' });
    }

    if (challenge.otp_code !== otp_code.trim()) {
      await pool.query(`UPDATE agripump.otp_challenges SET attempts = attempts + 1 WHERE phone_number = $1`, [cleanPhone]);
      const remainingAttempts = 4 - challenge.attempts;
      return res.status(401).json({
        error: `Authentication Failed: Invalid OTP code. ${remainingAttempts > 0 ? remainingAttempts + ' attempts remaining.' : 'Challenge locked.'}`
      });
    }

    // OTP verified successfully! Consume challenge
    await pool.query(`DELETE FROM agripump.otp_challenges WHERE phone_number = $1`, [cleanPhone]);

    // STRICT USER LOOKUP BY PHONE NUMBER ALONE
    let userRecord;
    const dbUserRes = await pool.query(
      `SELECT id, full_name, phone_number, role, hierarchy_path, totp_enabled, account_status FROM agripump.users WHERE phone_number = $1`,
      [cleanPhone]
    );

    if (dbUserRes.rows.length > 0) {
      userRecord = dbUserRes.rows[0];
    } else {
      // Auto-provision new account for a verified-but-unknown mobile number.
      // Always 'customer' — see SEC-3 note above. An unrecognised number
      // has proven it controls that phone, nothing more.
      const newIdRes = await pool.query(`SELECT public.uuid_generate_v4() as new_id`);
      const newId = newIdRes.rows[0].new_id;
      const userPath = `${ROOT_HIERARCHY_PATH}/${newId}`;

      const newUserRes = await pool.query(
        `INSERT INTO agripump.users (id, full_name, phone_number, role, hierarchy_path, parent_user_id, preferred_language)
         VALUES ($1, $2, $3, 'customer', $4, $5, 'hi')
         RETURNING id, full_name, phone_number, role, hierarchy_path`,
        [newId, `Farmer ${cleanPhone.slice(-4)}`, cleanPhone, userPath, ROOT_HIERARCHY_PATH]
      );
      userRecord = newUserRes.rows[0];
      await writeAudit(pool, {
        actorId: null, actorRole: 'system', entityType: 'user', entityId: newId,
        action: 'AUTO_PROVISION_CUSTOMER', after: userRecord, ip: req.ip
      });
    }

    await finishAuth(res, userRecord, 'OTP authentication successful');
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 0C. POST /api/auth/login-password: Administrative Password Verification
// ----------------------------------------------------------------------------
app.post(
  '/api/auth/login-password',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 8, keyFn: keyByIpAndBody('phone_number') }),
  async (req, res) => {
  try {
    const { phone_number, password } = req.body;
    if (!phone_number || !password) {
      return res.status(400).json({ error: 'phone_number and password are required' });
    }

    const cleanPhone = phone_number.trim().replace(/\s+/g, '');

    // STRICT USER LOOKUP BY PHONE NUMBER
    const dbUserRes = await pool.query(
      `SELECT id, full_name, phone_number, role, hierarchy_path, password_hash, totp_enabled, account_status FROM agripump.users WHERE phone_number = $1`,
      [cleanPhone]
    );

    if (dbUserRes.rows.length === 0) {
      return res.status(401).json({ error: 'Authentication Failed: Account not found' });
    }

    const userRecord = dbUserRes.rows[0];
    if (!userRecord.password_hash || !verifySecret(password.trim(), userRecord.password_hash)) {
      return res.status(401).json({ error: 'Authentication Failed: Incorrect password' });
    }

    await finishAuth(res, userRecord, 'Password authentication successful');
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 0D. POST /api/auth/refresh: Exchange a refresh token for a new token pair
// (FR-CLD-041 — 15 min access tokens need a refresh path to be usable at all)
// ----------------------------------------------------------------------------
app.post('/api/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'refreshToken is required' });
    }
    const tokenHash = hashRefreshToken(refreshToken);

    const result = await pool.query(
      `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at, u.id as uid, u.full_name, u.phone_number, u.role, u.hierarchy_path, u.totp_enabled, u.account_status
       FROM agripump.refresh_tokens rt
       JOIN agripump.users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    const row = result.rows[0];
    if (row.revoked_at || new Date(row.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Refresh token expired or already used. Please sign in again.' });
    }
    // A suspension mid-session must take effect at the next refresh, not
    // linger for the rest of the 15-minute access token (FR-CLD-041's 60s
    // revocation window is about this exact gap).
    if (row.account_status === 'SUSPENDED') {
      return res.status(403).json({ error: 'This account has been suspended. Contact your administrator.' });
    }

    // Rotate: revoke the token just used, issue a fresh pair. MFA is not
    // re-challenged on refresh — that would defeat the point of a refresh
    // token (silent renewal of an already-completed session), and this
    // path is only reachable with a valid refresh token that was itself
    // only ever issued after MFA succeeded (see finishAuth/mfa-verify).
    const userRecord = {
      id: row.uid, full_name: row.full_name, phone_number: row.phone_number,
      role: row.role, hierarchy_path: row.hierarchy_path, totp_enabled: row.totp_enabled
    };
    const { accessToken, refreshToken: newRefreshToken, expiresIn } = await issueTokenPair(pool, userRecord);

    const newRows = await pool.query(`SELECT id FROM agripump.refresh_tokens WHERE token_hash = $1`, [hashRefreshToken(newRefreshToken)]);
    await pool.query(
      `UPDATE agripump.refresh_tokens SET revoked_at = CURRENT_TIMESTAMP, replaced_by = $1 WHERE id = $2`,
      [newRows.rows[0] ? newRows.rows[0].id : null, row.id]
    );

    res.json({ token: accessToken, refreshToken: newRefreshToken, expiresIn, user: userRecord });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 0E. POST /api/auth/logout: Revoke the caller's refresh token(s)
// ----------------------------------------------------------------------------
app.post('/api/auth/logout', authenticateToken, async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await pool.query(
        `UPDATE agripump.refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [hashRefreshToken(refreshToken), req.user.id]
      );
    } else {
      // No specific token given — revoke every live session for this user.
      await pool.query(
        `UPDATE agripump.refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND revoked_at IS NULL`,
        [req.user.id]
      );
    }
    res.json({ message: 'Logged out' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 0F. POST /api/auth/mfa/setup: Begin TOTP enrollment (authenticated).
//     Generates and stores a secret but does NOT enable MFA yet — that
//     only happens once /mfa/enable proves the user actually has it
//     working (right code, clocks agree), via a real code from the app.
// ----------------------------------------------------------------------------
app.post('/api/auth/mfa/setup', authenticateToken, async (req, res) => {
  try {
    const secret = generateSecret();
    await pool.query(`UPDATE agripump.users SET totp_secret = $1 WHERE id = $2`, [secret, req.user.id]);
    const otpauthUrl = buildOtpauthUrl({ secret, accountName: req.user.phone_number, issuer: 'AgriPump SmartSpace' });
    res.json({ secret, otpauth_url: otpauthUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 0G. POST /api/auth/mfa/enable: Confirm enrollment with a real code.
// ----------------------------------------------------------------------------
app.post('/api/auth/mfa/enable', authenticateToken, async (req, res) => {
  try {
    const { code } = req.body;
    const userRes = await pool.query(`SELECT totp_secret FROM agripump.users WHERE id = $1`, [req.user.id]);
    const secret = userRes.rows[0]?.totp_secret;
    if (!secret) {
      return res.status(400).json({ error: 'Call POST /api/auth/mfa/setup first to generate a secret' });
    }
    if (!verifyTotp(secret, code)) {
      return res.status(401).json({ error: 'Incorrect code — check the time on your device and try again' });
    }
    await pool.query(`UPDATE agripump.users SET totp_enabled = TRUE WHERE id = $1`, [req.user.id]);
    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'user', entityId: req.user.id,
      action: 'MFA_ENABLED', ip: req.ip
    });
    res.json({ message: 'MFA enabled' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 0H. POST /api/auth/mfa/disable: Turn MFA off — still requires a valid
//     current code, so a stolen (but not MFA-completed) session can't
//     disable the protection it's missing.
// ----------------------------------------------------------------------------
app.post('/api/auth/mfa/disable', authenticateToken, async (req, res) => {
  try {
    const { code } = req.body;
    const userRes = await pool.query(`SELECT totp_secret, totp_enabled FROM agripump.users WHERE id = $1`, [req.user.id]);
    const row = userRes.rows[0];
    if (!row?.totp_enabled) {
      return res.status(400).json({ error: 'MFA is not currently enabled' });
    }
    if (!verifyTotp(row.totp_secret, code)) {
      return res.status(401).json({ error: 'Incorrect code' });
    }
    await pool.query(`UPDATE agripump.users SET totp_enabled = FALSE, totp_secret = NULL WHERE id = $1`, [req.user.id]);
    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'user', entityId: req.user.id,
      action: 'MFA_DISABLED', ip: req.ip
    });
    res.json({ message: 'MFA disabled' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 0I. POST /api/auth/mfa/verify: Second step of login for an MFA-enabled
//     account. Deliberately NOT behind authenticateToken — the caller
//     only holds an mfa_token (privilege-free, rejected by
//     authenticateToken itself — see middleware/authMiddleware.js), not a
//     real session yet.
// ----------------------------------------------------------------------------
app.post('/api/auth/mfa/verify', async (req, res) => {
  try {
    const { mfa_token, code } = req.body;
    if (!mfa_token || !code) {
      return res.status(400).json({ error: 'mfa_token and code are required' });
    }
    const payload = verifyToken(mfa_token);
    if (!payload || !payload.mfaPending) {
      return res.status(401).json({ error: 'MFA challenge expired or invalid — please sign in again' });
    }

    const userRes = await pool.query(
      `SELECT id, full_name, phone_number, role, hierarchy_path, totp_secret, totp_enabled FROM agripump.users WHERE id = $1`,
      [payload.mfaPending]
    );
    const userRecord = userRes.rows[0];
    if (!userRecord || !userRecord.totp_enabled) {
      return res.status(401).json({ error: 'MFA challenge no longer valid for this account' });
    }
    if (!verifyTotp(userRecord.totp_secret, code)) {
      return res.status(401).json({ error: 'Incorrect code' });
    }

    const { accessToken, refreshToken, expiresIn } = await issueTokenPair(pool, userRecord);
    res.json({
      message: 'MFA verified',
      token: accessToken,
      refreshToken,
      expiresIn,
      mfa_setup_required: false, // already enabled, or this branch wouldn't have run
      user: {
        id: userRecord.id,
        full_name: userRecord.full_name,
        phone_number: userRecord.phone_number,
        role: userRecord.role,
        hierarchy_path: userRecord.hierarchy_path,
        totp_enabled: Boolean(userRecord.totp_enabled)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 0J. GET /api/fleet/dashboard: Fleet-wide aggregates (FR-WEB-014) — device
//     counts by lifecycle state, online/offline, active faults by type,
//     top faulting devices, firmware version distribution. Scoped by
//     hierarchy_path exactly like GET /api/pumps; every number here is a
//     real aggregate query, not a placeholder.
// ----------------------------------------------------------------------------
app.get('/api/fleet/dashboard', authenticateToken, async (req, res) => {
  try {
    const parentPath = req.user.role === 'superadmin' ? (req.query.hierarchy_path || ROOT_HIERARCHY_PATH) : (req.user.hierarchy_path || ROOT_HIERARCHY_PATH);

    const [lifecycle, connectivity, faultsByType, topFaulting, firmware, faultsToday, warrantyExpiring] = await Promise.all([
      pool.query(
        `SELECT lifecycle_state, COUNT(*) AS count FROM agripump.pumps
         WHERE hierarchy_path LIKE $1 || '%' GROUP BY lifecycle_state`,
        [parentPath]
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE last_seen_at >= CURRENT_TIMESTAMP - INTERVAL '15 minutes') AS online_count,
           COUNT(*) FILTER (WHERE last_seen_at IS NULL OR last_seen_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes') AS offline_count
         FROM agripump.pumps WHERE hierarchy_path LIKE $1 || '%'`,
        [parentPath]
      ),
      pool.query(
        `SELECT fl.fault_code, fcc.name, fcc.severity, COUNT(*) AS count
         FROM agripump.fault_logs fl
         JOIN agripump.pumps p ON p.id = fl.pump_id
         LEFT JOIN agripump.fault_code_catalog fcc ON fcc.code = fl.fault_code
         WHERE p.hierarchy_path LIKE $1 || '%' AND fl.resolved_at IS NULL
         GROUP BY fl.fault_code, fcc.name, fcc.severity
         ORDER BY count DESC`,
        [parentPath]
      ),
      pool.query(
        `SELECT p.id, p.name, COUNT(fl.id) AS fault_count
         FROM agripump.pumps p
         JOIN agripump.fault_logs fl ON fl.pump_id = p.id AND fl.occurred_at > CURRENT_TIMESTAMP - INTERVAL '30 days'
         WHERE p.hierarchy_path LIKE $1 || '%'
         GROUP BY p.id, p.name
         ORDER BY fault_count DESC
         LIMIT 10`,
        [parentPath]
      ),
      pool.query(
        `SELECT COALESCE(firmware_version, 'unreported') AS firmware_version, COUNT(*) AS count
         FROM agripump.pumps WHERE hierarchy_path LIKE $1 || '%'
         GROUP BY firmware_version ORDER BY count DESC`,
        [parentPath]
      ),
      // FR-WEB-033 sub-tree dashboard — this endpoint IS the sub-tree
      // dashboard (already hierarchy-scoped per caller); these two extra
      // aggregates are what it was missing. "Subscription" is deliberately
      // absent — this system has no subscription/billing concept at all,
      // so showing one would mean fabricating it.
      pool.query(
        `SELECT COUNT(*) AS count
         FROM agripump.fault_logs fl
         JOIN agripump.pumps p ON p.id = fl.pump_id
         WHERE p.hierarchy_path LIKE $1 || '%' AND fl.occurred_at >= CURRENT_DATE`,
        [parentPath]
      ),
      pool.query(
        `SELECT id, name, (warranty_start_date + (warranty_period_months || ' months')::interval)::date AS warranty_end_date
         FROM agripump.pumps
         WHERE hierarchy_path LIKE $1 || '%'
           AND warranty_start_date IS NOT NULL AND warranty_period_months IS NOT NULL
           AND (warranty_start_date + (warranty_period_months || ' months')::interval)
               BETWEEN CURRENT_TIMESTAMP AND CURRENT_TIMESTAMP + INTERVAL '30 days'
         ORDER BY warranty_end_date ASC
         LIMIT 10`,
        [parentPath]
      )
    ]);

    res.json({
      lifecycle_counts: lifecycle.rows,
      connectivity: connectivity.rows[0],
      active_faults_by_type: faultsByType.rows,
      top_faulting_devices_30d: topFaulting.rows,
      firmware_distribution: firmware.rows,
      faults_today_count: parseInt(faultsToday.rows[0].count, 10),
      warranty_expiring_30d: warrantyExpiring.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 0J2. Service reports (FR-WEB-037) — fault frequency, MTBF, runtime hours
//     and uptime %, to support field service planning. Computed live from
//     fault_logs + telemetry_history, not a precomputed rollup — no new
//     schema needed. Metric definitions (SRS §8.3 names the four metrics
//     without defining them, so this is explicit):
//
//     - fault_count: fault_logs rows for the pump within the window.
//     - runtime_hours: telemetry_history samples arrive irregularly
//       (2-5 min depending on pump state), so this is reconstructed by
//       summing the gap between consecutive samples wherever the EARLIER
//       sample reported pump_on = true (the state persisted for that gap).
//       Each gap is capped at 15 minutes — the same connectivity threshold
//       used elsewhere (e.g. GET /api/fleet/dashboard's online/offline
//       split) — so an offline period is never credited as runtime.
//     - uptime_pct: fraction of the requested window during which the
//       device was actively reporting (i.e. covered by a capped,
//       <=15-minute gap) rather than dark. Deliberately a connectivity
//       signal distinct from runtime_hours — a pump can be legitimately
//       OFF while still fully "up" and reporting.
//     - mtbf_hours: runtime_hours / fault_count. Null (not Infinity) when
//       there were zero faults in the window — insufficient data, not a
//       fabricated "perfect" number.
// ----------------------------------------------------------------------------
function parseReportDays(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 30;
  return Math.min(n, 365);
}

const SERVICE_REPORT_CTE = `
  , windowed AS (
    SELECT
      t.pump_id,
      t.recorded_at,
      t.pump_on,
      LAG(t.recorded_at) OVER (PARTITION BY t.pump_id ORDER BY t.recorded_at) AS prev_recorded_at,
      LAG(t.pump_on) OVER (PARTITION BY t.pump_id ORDER BY t.recorded_at) AS prev_pump_on
    FROM agripump.telemetry_history t
    JOIN scoped_pumps sp ON sp.id = t.pump_id
    WHERE t.recorded_at BETWEEN $2 AND $3
  ),
  gaps AS (
    SELECT
      pump_id,
      LEAST(EXTRACT(EPOCH FROM (recorded_at - prev_recorded_at)), 900) AS capped_gap_seconds,
      prev_pump_on
    FROM windowed
    WHERE prev_recorded_at IS NOT NULL
  ),
  runtime AS (
    SELECT
      pump_id,
      COALESCE(SUM(capped_gap_seconds), 0) AS uptime_seconds,
      COALESCE(SUM(capped_gap_seconds) FILTER (WHERE prev_pump_on), 0) AS runtime_seconds
    FROM gaps
    GROUP BY pump_id
  ),
  faults AS (
    SELECT fl.pump_id, COUNT(*) AS fault_count
    FROM agripump.fault_logs fl
    JOIN scoped_pumps sp ON sp.id = fl.pump_id
    WHERE fl.occurred_at BETWEEN $2 AND $3
    GROUP BY fl.pump_id
  )
  SELECT
    sp.id,
    sp.name,
    COALESCE(f.fault_count, 0) AS fault_count,
    ROUND((COALESCE(r.runtime_seconds, 0) / 3600.0)::numeric, 2) AS runtime_hours,
    CASE WHEN COALESCE(f.fault_count, 0) > 0
         THEN ROUND(((COALESCE(r.runtime_seconds, 0) / 3600.0) / f.fault_count)::numeric, 2)
         ELSE NULL END AS mtbf_hours,
    ROUND(LEAST(100, 100.0 * COALESCE(r.uptime_seconds, 0) / NULLIF(EXTRACT(EPOCH FROM ($3::timestamptz - $2::timestamptz)), 0))::numeric, 1) AS uptime_pct
  FROM scoped_pumps sp
  LEFT JOIN runtime r ON r.pump_id = sp.id
  LEFT JOIN faults f ON f.pump_id = sp.id
`;

app.get('/api/service-reports', authenticateToken, async (req, res) => {
  try {
    const parentPath = req.user.role === 'superadmin' ? (req.query.hierarchy_path || ROOT_HIERARCHY_PATH) : (req.user.hierarchy_path || ROOT_HIERARCHY_PATH);
    const days = parseReportDays(req.query.days);
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - days * 24 * 60 * 60 * 1000);

    const result = await pool.query(
      `WITH scoped_pumps AS (
         SELECT id, name FROM agripump.pumps WHERE hierarchy_path LIKE $1 || '%'
       )
       ${SERVICE_REPORT_CTE}
       ORDER BY sp.name`,
      [parentPath, windowStart, windowEnd]
    );

    res.json({ days, window_start: windowStart, window_end: windowEnd, reports: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pumps/:id/service-report', authenticateToken, async (req, res) => {
  try {
    const pump = await getPumpInScope(pool, req.params.id, req.user);
    if (!pump) return res.status(404).json({ error: 'Pump device not found' });

    const days = parseReportDays(req.query.days);
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - days * 24 * 60 * 60 * 1000);

    const result = await pool.query(
      `WITH scoped_pumps AS (
         SELECT id, name FROM agripump.pumps WHERE id = $1
       )
       ${SERVICE_REPORT_CTE}`,
      [pump.id, windowStart, windowEnd]
    );

    res.json({ days, window_start: windowStart, window_end: windowEnd, report: result.rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 0K. GET /api/system/health: Real process/DB/notification metrics
//     (FR-WEB-017). Every field is either a live read (process.uptime(),
//     the pg Pool's own totalCount/idleCount/waitingCount, a SELECT 1
//     round-trip) or a counter incremented at the exact code path it
//     describes (services/metrics.js) — there is no synthetic or estimated
//     number on this endpoint. Superadmin only, matching the System Health
//     nav item — this is process-level operational data, not scoped to any
//     tenant's hierarchy_path.
// ----------------------------------------------------------------------------
app.get('/api/system/health', authenticateToken, requireRole(['superadmin']), async (req, res) => {
  const dbStartedAt = Date.now();
  try {
    await pool.query('SELECT 1');
    const dbLatencyMs = Date.now() - dbStartedAt;

    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      process: {
        uptime_seconds: Math.floor(process.uptime()),
        node_version: process.version,
        env: process.env.NODE_ENV || 'not set (defaults to production-safe)'
      },
      database: {
        connected: true,
        latency_ms: dbLatencyMs,
        pool_total: pool.totalCount,
        pool_idle: pool.idleCount,
        pool_waiting: pool.waitingCount
      },
      metrics: metrics.snapshot()
    });
  } catch (err) {
    res.status(503).json({
      status: 'DEGRADED',
      timestamp: new Date().toISOString(),
      error: err.message,
      database: { connected: false, pool_total: pool.totalCount, pool_idle: pool.idleCount, pool_waiting: pool.waitingCount },
      metrics: metrics.snapshot()
    });
  }
});

// ----------------------------------------------------------------------------
// 1. GET /api/pumps: Scalable Authenticated Fetch for Fleet Devices
// ----------------------------------------------------------------------------
app.get('/api/pumps', authenticateToken, async (req, res) => {
  try {
    const userHierarchyPath = req.user.hierarchy_path || ROOT_HIERARCHY_PATH;

    // STRICT HIERARCHY SCOPING FIX: Non-superadmin users CANNOT override hierarchy_path via query string
    const parentPath = (req.user.role === 'superadmin')
      ? (req.query.hierarchy_path || userHierarchyPath)
      : userHierarchyPath;

    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${req.query.search}%` : null;

    // LATERAL join onto each pump's latest telemetry row (Web_App_Pending_Items.md
    // W0): the list previously returned no electrical readings at all, so the
    // frontend had nothing to bind and shipped literals. One row per pump via
    // LIMIT 1 inside the LATERAL, so this stays O(n) rather than a self-join
    // fan-out.
    let queryText = `
      SELECT p.id, p.name, p.supply_type, p.hp_rating, p.latitude, p.longitude,
             p.status, p.lifecycle_state, p.firmware_version, p.last_seen_at,
             t.v_ry, t.v_yb, t.v_br, t.i_r, t.i_y, t.i_b, t.gsm_rssi,
             t.recorded_at AS telemetry_recorded_at, t.ts_approx, t.buffered
      FROM agripump.pumps p
      LEFT JOIN LATERAL (
        SELECT v_ry, v_yb, v_br, i_r, i_y, i_b, gsm_rssi, recorded_at, ts_approx, buffered
        FROM agripump.telemetry_history th
        WHERE th.pump_id = p.id
        ORDER BY th.recorded_at DESC
        LIMIT 1
      ) t ON true
      WHERE p.hierarchy_path LIKE $1 || '%'
    `;
    let queryParams = [parentPath];

    if (search) {
      queryParams.push(search);
      queryText += ` AND (p.name ILIKE $${queryParams.length} OR p.id ILIKE $${queryParams.length})`;
    }

    queryText += ` ORDER BY p.name ASC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    queryParams.push(limit, offset);

    const result = await pool.query(queryText, queryParams);

    const statsRes = await pool.query(
      `SELECT
         COUNT(*) as total_devices,
         COUNT(*) FILTER (WHERE status = 'RUNNING') as running_count,
         COUNT(*) FILTER (WHERE status = 'FAULT') as fault_count,
         COUNT(*) FILTER (WHERE status = 'STOPPED') as stopped_count,
         COUNT(*) FILTER (WHERE last_seen_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes') as offline_count
       FROM agripump.pumps
       WHERE hierarchy_path LIKE $1 || '%'`,
      [parentPath]
    );

    res.json({
      meta: { page, limit, stats: statsRes.rows[0] },
      pumps: result.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 1B. GET /api/pumps/:id: Device detail (overview + latest telemetry +
//     config + open fault count) — backs a future device-detail view; today
//     it at least makes the data that already exists in Postgres readable.
// ----------------------------------------------------------------------------
app.get('/api/pumps/:id', authenticateToken, async (req, res) => {
  try {
    const pump = await getPumpInScope(pool, req.params.id, req.user);
    if (!pump) return res.status(404).json({ error: 'Pump device not found' });

    const [latestTelemetry, config, openFaults] = await Promise.all([
      pool.query(`SELECT * FROM agripump.telemetry_history WHERE pump_id = $1 ORDER BY recorded_at DESC LIMIT 1`, [pump.id]),
      pool.query(`SELECT desired_json, reported_json, status, updated_at FROM agripump.device_config WHERE pump_id = $1`, [pump.id]),
      pool.query(`SELECT COUNT(*) as open_fault_count FROM agripump.fault_logs WHERE pump_id = $1 AND resolved_at IS NULL`, [pump.id])
    ]);

    res.json({
      pump: sanitizePump(pump),
      latest_telemetry: latestTelemetry.rows[0] || null,
      config: config.rows[0] || null,
      open_fault_count: parseInt(openFaults.rows[0].open_fault_count, 10)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 1B. GET /api/pumps/:id/provenance: Ownership + allocation history +
//     warranty + manufacturing origin (§8.4 Ownership/Diagnostics tabs,
//     Web_App_Pending_Items.md §6). `allocation_log` has existed since the
//     original schema for FR-SEC-003 but had no reader until now (W4's
//     bulk-allocate endpoint was its first writer). `batch_imeis` is
//     joined in reverse (pump_id -> batch) to surface hw_rev/mcu_uid/imei
//     only when the device was actually claimed from a tracked
//     manufacturing batch — NULL for a hand-created pump, which is
//     honest: it has no batch to report, not a fabricated "unknown".
// ----------------------------------------------------------------------------
app.get('/api/pumps/:id/provenance', authenticateToken, async (req, res) => {
  try {
    const pump = await getPumpInScope(pool, req.params.id, req.user);
    if (!pump) return res.status(404).json({ error: 'Pump device not found' });

    const [ownerRes, historyRes, batchRes] = await Promise.all([
      pool.query(`SELECT id, full_name, phone_number, role FROM agripump.users WHERE id = $1`, [pump.owner_user_id]),
      pool.query(
        `SELECT al.id, al.occurred_at, al.note,
                fu.id AS from_user_id, fu.full_name AS from_full_name,
                tu.id AS to_user_id, tu.full_name AS to_full_name,
                au.id AS actor_id, au.full_name AS actor_full_name
         FROM agripump.allocation_log al
         LEFT JOIN agripump.users fu ON fu.id = al.from_user_id
         LEFT JOIN agripump.users tu ON tu.id = al.to_user_id
         LEFT JOIN agripump.users au ON au.id = al.actor_id
         WHERE al.pump_id = $1
         ORDER BY al.occurred_at DESC`,
        [pump.id]
      ),
      pool.query(
        `SELECT bi.imei, bi.mcu_uid, bi.claimed_at, db.batch_code, db.model, db.hw_rev
         FROM agripump.batch_imeis bi
         JOIN agripump.device_batches db ON db.id = bi.batch_id
         WHERE bi.pump_id = $1`,
        [pump.id]
      )
    ]);

    let warranty = null;
    if (pump.warranty_start_date && pump.warranty_period_months) {
      const start = new Date(pump.warranty_start_date);
      const end = new Date(start);
      end.setMonth(end.getMonth() + pump.warranty_period_months);
      warranty = {
        start_date: pump.warranty_start_date,
        period_months: pump.warranty_period_months,
        end_date: end.toISOString().slice(0, 10),
        expired: end < new Date()
      };
    }

    res.json({
      owner: ownerRes.rows[0] || null,
      allocation_history: historyRes.rows,
      warranty,
      batch: batchRes.rows[0] || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 1C. PUT /api/pumps/:id/warranty: Set warranty period (Superadmin Only)
// ----------------------------------------------------------------------------
app.put('/api/pumps/:id/warranty', authenticateToken, requireRole(['superadmin']), async (req, res) => {
  try {
    const { warranty_start_date, warranty_period_months } = req.body;
    const before = await pool.query(`SELECT warranty_start_date, warranty_period_months FROM agripump.pumps WHERE id = $1`, [req.params.id]);
    if (before.rows.length === 0) return res.status(404).json({ error: 'Pump device not found' });

    const result = await pool.query(
      `UPDATE agripump.pumps SET warranty_start_date = $1, warranty_period_months = $2 WHERE id = $3
       RETURNING id, warranty_start_date, warranty_period_months`,
      [warranty_start_date || null, warranty_period_months || null, req.params.id]
    );

    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'pump', entityId: req.params.id,
      action: 'SET_WARRANTY', before: before.rows[0], after: result.rows[0], ip: req.ip
    });

    res.json({ message: 'Warranty updated', pump: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 1D. PUT /api/pumps/:id/panel: Panel binding (FR-WEB-031) — panel serial,
//     motor rating, starter type, pump make/model. Direct columns on
//     pumps (see schema.sql), scoped the same as other install-time
//     device edits (superadmin down through dealer, not customer).
// ----------------------------------------------------------------------------
app.put(
  '/api/pumps/:id/panel',
  authenticateToken,
  requireRole(['superadmin', 'manufacturer', 'distributor', 'dealer']),
  async (req, res) => {
  try {
    const pump = await getPumpInScope(pool, req.params.id, req.user);
    if (!pump) return res.status(404).json({ error: 'Pump device not found' });

    const { panel_serial, motor_rating, starter_type, pump_make, pump_model } = req.body;
    const result = await pool.query(
      `UPDATE agripump.pumps SET panel_serial = $1, motor_rating = $2, starter_type = $3, pump_make = $4, pump_model = $5
       WHERE id = $6
       RETURNING id, panel_serial, motor_rating, starter_type, pump_make, pump_model`,
      [panel_serial || null, motor_rating || null, starter_type || null, pump_make || null, pump_model || null, pump.id]
    );

    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'pump', entityId: pump.id,
      action: 'SET_PANEL_BINDING', after: result.rows[0], ip: req.ip
    });

    res.json({ message: 'Panel binding updated', pump: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 1E. Component swap history — FR-WEB-034. See schema.sql's "COMPONENT
//     SWAP HISTORY" section for the frequent/cheap-vs-rare/expensive
//     distinction this splits on.
// ----------------------------------------------------------------------------
app.get('/api/pumps/:id/mcu-swap-history', authenticateToken, async (req, res) => {
  try {
    const pump = await getPumpInScope(pool, req.params.id, req.user);
    if (!pump) return res.status(404).json({ error: 'Pump device not found' });

    const [history, provisioned] = await Promise.all([
      pool.query(
        `SELECT msl.id, msl.old_mcu_uid, msl.new_mcu_uid, msl.reason, msl.occurred_at, u.full_name AS performed_by_name
         FROM agripump.mcu_swap_log msl
         LEFT JOIN agripump.users u ON u.id = msl.performed_by
         WHERE msl.pump_id = $1 ORDER BY msl.occurred_at DESC`,
        [pump.id]
      ),
      pool.query(`SELECT mcu_uid FROM agripump.batch_imeis WHERE pump_id = $1`, [pump.id])
    ]);

    // Current-fitted MCU is whichever swap is most recent; falling back to
    // the provisioning-time value if the pump has never been swapped.
    const currentMcuUid = history.rows[0]?.new_mcu_uid ?? provisioned.rows[0]?.mcu_uid ?? null;

    res.json({ current_mcu_uid: currentMcuUid, history: history.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post(
  '/api/pumps/:id/mcu-swap',
  authenticateToken,
  requireRole(['superadmin', 'manufacturer', 'distributor', 'dealer']),
  async (req, res) => {
  try {
    const pump = await getPumpInScope(pool, req.params.id, req.user);
    if (!pump) return res.status(404).json({ error: 'Pump device not found' });

    const { new_mcu_uid, reason } = req.body;
    if (!new_mcu_uid || !new_mcu_uid.trim()) {
      return res.status(400).json({ error: 'new_mcu_uid is required' });
    }

    const [lastSwap, provisioned] = await Promise.all([
      pool.query(`SELECT new_mcu_uid FROM agripump.mcu_swap_log WHERE pump_id = $1 ORDER BY occurred_at DESC LIMIT 1`, [pump.id]),
      pool.query(`SELECT mcu_uid FROM agripump.batch_imeis WHERE pump_id = $1`, [pump.id])
    ]);
    const oldMcuUid = lastSwap.rows[0]?.new_mcu_uid ?? provisioned.rows[0]?.mcu_uid ?? null;

    const result = await pool.query(
      `INSERT INTO agripump.mcu_swap_log (pump_id, old_mcu_uid, new_mcu_uid, reason, performed_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [pump.id, oldMcuUid, new_mcu_uid.trim(), reason || null, req.user.id]
    );

    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'pump', entityId: pump.id,
      action: 'MCU_SWAP', before: { mcu_uid: oldMcuUid }, after: result.rows[0], ip: req.ip
    });

    res.status(201).json({ message: 'MCU swap logged', swap: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pumps/:id/bridge-swap — the rare/expensive path: the whole
// modem is replaced, so the device's identity changes (IMEI = pump_id,
// D-4). Implemented as a literal primary-key rename; the six FKs that
// reference pumps.id were retrofitted to ON UPDATE CASCADE specifically
// so this carries telemetry/fault/config/command/allocation/batch history
// to the new id automatically (verified live before this endpoint was
// written — see the schema.sql section 15 comment). Wrapped in an
// explicit transaction: this is the one operation in this codebase
// significant enough (a PK rename plus a fresh device key) that a
// partial failure partway through would leave real confusion behind.
// Superadmin-only given how rare and high-impact this is meant to be.
app.post('/api/pumps/:id/bridge-swap', authenticateToken, requireRole(['superadmin']), async (req, res) => {
  const client = await pool.connect();
  try {
    const { new_imei, reason } = req.body;
    if (!new_imei || !/^\d{15}$/.test(new_imei) || !isValidImei(new_imei)) {
      return res.status(400).json({ error: 'new_imei must be a valid 15-digit IMEI (passes the check-digit test)' });
    }

    const pump = await getPumpInScope(client, req.params.id, req.user);
    if (!pump) return res.status(404).json({ error: 'Pump device not found' });

    const clash = await client.query(`SELECT id FROM agripump.pumps WHERE id = $1`, [new_imei]);
    if (clash.rows.length > 0) {
      return res.status(409).json({ error: `IMEI ${new_imei} is already in use by another device` });
    }

    const oldId = pump.id;
    const deviceKeyPlain = crypto.randomBytes(16).toString('base64url');
    const deviceKeyHash = hashSecret(deviceKeyPlain);

    await client.query('BEGIN');
    await client.query(`UPDATE agripump.pumps SET id = $1, device_key_hash = $2 WHERE id = $3`, [new_imei, deviceKeyHash, oldId]);
    const swapLogRes = await client.query(
      `INSERT INTO agripump.bridge_swap_log (old_pump_id, new_pump_id, reason, performed_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [oldId, new_imei, reason || null, req.user.id]
    );
    await client.query('COMMIT');

    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'pump', entityId: new_imei,
      action: 'BRIDGE_SWAP', before: { id: oldId }, after: swapLogRes.rows[0], ip: req.ip
    });

    const broadcastPump = await fetchPumpBroadcastRow(pool, new_imei);
    if (broadcastPump) broadcastPumpUpdate(broadcastPump);

    res.status(201).json({
      message: `Device identity migrated from ${oldId} to ${new_imei} — all history carried over`,
      swap: swapLogRes.rows[0],
      new_pump_id: new_imei,
      // Shown once, same convention as device creation — the new modem
      // has never held the old key, so telemetry ingestion needs this.
      device_key: deviceKeyPlain
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ----------------------------------------------------------------------------
// 2. POST /api/pumps: Register New Pump (Superadmin Exclusivity)
// ----------------------------------------------------------------------------
app.post('/api/pumps', authenticateToken, requireRole(['superadmin']), async (req, res) => {
  try {
    const { id, name, supply_type, hp_rating, latitude, longitude, hierarchy_path } = req.body;

    if (!id || !name) {
      return res.status(400).json({ error: 'Device ID (Thing Name) and Pump Name are required' });
    }

    const pumpId = id.trim().toUpperCase();
    const pumpName = name.trim();
    const sType = supply_type || '3-phase';
    const hp = parseFloat(hp_rating) || 15.0;
    const lat = parseFloat(latitude) || 19.9975;
    const lng = parseFloat(longitude) || 73.7898;
    const hPath = hierarchy_path || req.user.hierarchy_path || ROOT_HIERARCHY_PATH;

    // Generate a device telemetry key here so the pump is immediately usable
    // by the simulator / a real device without a separate provisioning step
    // (SEC-1 — telemetry ingestion now requires this key).
    const deviceKeyPlain = crypto.randomBytes(16).toString('base64url');
    const deviceKeyHash = hashSecret(deviceKeyPlain);

    const result = await pool.query(
      `INSERT INTO agripump.pumps (id, name, supply_type, hp_rating, owner_user_id, latitude, longitude, status, hierarchy_path, device_key_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'STOPPED', $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         supply_type = EXCLUDED.supply_type,
         hp_rating = EXCLUDED.hp_rating,
         latitude = EXCLUDED.latitude,
         longitude = EXCLUDED.longitude
       RETURNING id, name, supply_type, hp_rating, latitude, longitude, status, hierarchy_path, lifecycle_state`,
      [pumpId, pumpName, sType, hp, req.user.id, lat, lng, hPath, deviceKeyHash]
    );

    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'pump', entityId: pumpId,
      action: 'CREATE', after: result.rows[0], ip: req.ip
    });

    res.status(201).json({
      message: 'Pump device registered successfully',
      pump: result.rows[0],
      // Shown once — this is the only time the plaintext key is available.
      // Store it in the device's provisioning record / simulator config.
      device_key: deviceKeyPlain
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 3. POST /api/pumps/:id/location: Save GPS Location (Superadmin Exclusive)
// ----------------------------------------------------------------------------
app.post('/api/pumps/:id/location', authenticateToken, requireRole(['superadmin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { latitude, longitude } = req.body;

    const before = await pool.query(`SELECT id, latitude, longitude FROM agripump.pumps WHERE id = $1`, [id]);
    if (before.rows.length === 0) {
      return res.status(404).json({ error: 'Pump device not found' });
    }

    const result = await pool.query(
      `UPDATE agripump.pumps
       SET latitude = $1,
           longitude = $2,
           last_seen_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING id, name, latitude, longitude`,
      [latitude, longitude, id]
    );

    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'pump', entityId: id,
      action: 'UPDATE_LOCATION', before: before.rows[0], after: result.rows[0], ip: req.ip
    });

    res.json({ message: 'Location updated successfully', pump: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 4. DELETE /api/pumps/:id: Superadmin Delete Device Endpoint (Superadmin Exclusive)
// ----------------------------------------------------------------------------
app.delete('/api/pumps/:id', authenticateToken, requireRole(['superadmin']), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`DELETE FROM agripump.pumps WHERE id = $1 RETURNING id`, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pump device not found' });
    }

    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'pump', entityId: id,
      action: 'DELETE', before: { id }, ip: req.ip
    });

    res.json({ message: `Pump ${id} deleted successfully`, deleted_id: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 4A2. POST /api/pumps/:id/lifecycle: Device lifecycle state machine
//      (SRS §7.3, FR-SEC-010 — "allowed transitions shall be enforced
//      server-side as a state machine; illegal transitions shall be
//      rejected with an explicit error"). MANUFACTURED is start-only —
//      nothing legitimately transitions back into it, so it's absent as a
//      target anywhere in the map below.
// ----------------------------------------------------------------------------
const LIFECYCLE_TRANSITIONS = {
  MANUFACTURED: ['ALLOCATED'],
  ALLOCATED: ['IN_STOCK'],
  IN_STOCK: ['COMMISSIONED'],
  COMMISSIONED: ['ACTIVE'],
  ACTIVE: ['SUSPENDED', 'RMA', 'RETIRED'],
  SUSPENDED: ['ACTIVE', 'RMA', 'RETIRED'],
  RMA: ['IN_STOCK', 'RETIRED'],
  RETIRED: []
};

app.post(
  '/api/pumps/:id/lifecycle',
  authenticateToken,
  requireRole(['superadmin', 'manufacturer', 'distributor', 'dealer']),
  async (req, res) => {
  try {
    const { to_state } = req.body;
    if (!to_state || !(to_state in LIFECYCLE_TRANSITIONS)) {
      return res.status(400).json({ error: `to_state must be one of: ${Object.keys(LIFECYCLE_TRANSITIONS).join(', ')}` });
    }

    const pump = await getPumpInScope(pool, req.params.id, req.user);
    if (!pump) return res.status(404).json({ error: 'Pump device not found' });

    // §7.3 "Who can change": RETIRED (decommission + certificate revocation)
    // and re-entering ALLOCATED are Superadmin-only; SUSPENDED (cloud
    // service pause) is Superadmin/Panel Manufacturer.
    if (to_state === 'RETIRED' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Only Superadmin may retire a device' });
    }
    if (to_state === 'ALLOCATED' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Only Superadmin may allocate from factory inventory' });
    }
    if (to_state === 'SUSPENDED' && !['superadmin', 'manufacturer'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only Superadmin or Panel Manufacturer may suspend a device' });
    }

    const allowed = LIFECYCLE_TRANSITIONS[pump.lifecycle_state] || [];
    if (!allowed.includes(to_state)) {
      return res.status(409).json({
        error: `Illegal transition: ${pump.lifecycle_state} → ${to_state}`,
        current_state: pump.lifecycle_state,
        allowed_next_states: allowed
      });
    }

    const result = await pool.query(
      `UPDATE agripump.pumps SET lifecycle_state = $1 WHERE id = $2 RETURNING id, lifecycle_state`,
      [to_state, pump.id]
    );

    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'pump', entityId: pump.id,
      action: 'LIFECYCLE_TRANSITION', before: { lifecycle_state: pump.lifecycle_state }, after: result.rows[0], ip: req.ip
    });

    const broadcastPump = await fetchPumpBroadcastRow(pool, pump.id);
    if (broadcastPump) broadcastPumpUpdate(broadcastPump);

    res.json({ message: `Transitioned to ${to_state}`, pump: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 4A3. Factory Provisioning — device batches & IMEI whitelist
//      (FR-WEB-010 bulk inventory import, FR-WEB-011 factory console,
//      C-1 claim gating). Per Web_App_Pending_Items.md §5.1, the factory
//      is Superadmin-operated and single-tenant, so every route here is
//      superadmin-only — there is no partner-facing surface to scope by
//      hierarchy_path. Claim-certificate bundle generation (AWS IoT fleet
//      provisioning) is explicitly NOT built here: this backend has no AWS
//      SDK integration, so building a "download certificate" button would
//      be a fabricated capability. What's real and built: batch creation,
//      whitelist upload with per-row validation/error-report, and
//      claimed/unclaimed state visibility — the portal-side half of §5.1's
//      table. The device-side claim exchange itself is Stream 3.
// ----------------------------------------------------------------------------
app.post('/api/batches', authenticateToken, requireRole(['superadmin']), async (req, res) => {
  try {
    const { batch_code, model, hw_rev, quantity, manufacture_date } = req.body;
    if (!batch_code || !model) {
      return res.status(400).json({ error: 'batch_code and model are required' });
    }

    const result = await pool.query(
      `INSERT INTO agripump.device_batches (batch_code, model, hw_rev, quantity, manufacture_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, batch_code, model, hw_rev, quantity, manufacture_date, created_at, revoked`,
      [batch_code.trim(), model.trim(), hw_rev ? hw_rev.trim() : null, parseInt(quantity, 10) || 0, manufacture_date || null, req.user.id]
    );

    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'batch', entityId: result.rows[0].id,
      action: 'CREATE', after: result.rows[0], ip: req.ip
    });

    res.status(201).json({ message: 'Batch created', batch: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: `A batch with code "${req.body.batch_code}" already exists` });
    }
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/batches', authenticateToken, requireRole(['superadmin']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.id, b.batch_code, b.model, b.hw_rev, b.quantity, b.manufacture_date, b.created_at, b.revoked, b.revoked_at,
              COUNT(bi.id)::int AS imported_count,
              COUNT(bi.id) FILTER (WHERE bi.claimed)::int AS claimed_count
       FROM agripump.device_batches b
       LEFT JOIN agripump.batch_imeis bi ON bi.batch_id = b.id
       GROUP BY b.id
       ORDER BY b.created_at DESC`
    );
    res.json({ batches: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/batches/:id', authenticateToken, requireRole(['superadmin']), async (req, res) => {
  try {
    const batchRes = await pool.query(`SELECT * FROM agripump.device_batches WHERE id = $1`, [req.params.id]);
    if (batchRes.rows.length === 0) return res.status(404).json({ error: 'Batch not found' });

    const imeisRes = await pool.query(
      `SELECT id, imei, mcu_uid, claimed, claimed_at, pump_id, created_at
       FROM agripump.batch_imeis WHERE batch_id = $1 ORDER BY created_at ASC`,
      [req.params.id]
    );

    res.json({ batch: batchRes.rows[0], imeis: imeisRes.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/batches/:id/imeis', authenticateToken, requireRole(['superadmin']), async (req, res) => {
  try {
    const batchRes = await pool.query(`SELECT id, revoked FROM agripump.device_batches WHERE id = $1`, [req.params.id]);
    if (batchRes.rows.length === 0) return res.status(404).json({ error: 'Batch not found' });
    if (batchRes.rows[0].revoked) {
      return res.status(409).json({ error: 'This batch is revoked — no further IMEIs may be added to it' });
    }

    const parsedRows = parseImeiUpload(req.body.raw);
    if (parsedRows.length === 0) {
      return res.status(400).json({ error: 'No IMEI rows found in the upload' });
    }

    // One round trip to find every IMEI that already exists anywhere in the
    // whitelist (imei is globally unique per batch_imeis's schema
    // constraint, not just unique within this batch).
    const candidateImeis = parsedRows.map(r => r.imei);
    const existingRes = await pool.query(
      `SELECT imei FROM agripump.batch_imeis WHERE imei = ANY($1::varchar[])`,
      [candidateImeis]
    );
    const existingSet = new Set(existingRes.rows.map(r => r.imei));

    const seenInUpload = new Set();
    const toInsert = [];
    const errors = [];

    for (const row of parsedRows) {
      if (!/^\d{15}$/.test(row.imei)) {
        errors.push({ row: row.rowNumber, imei: row.imei, reason: 'IMEI must be exactly 15 digits' });
      } else if (!isValidImei(row.imei)) {
        errors.push({ row: row.rowNumber, imei: row.imei, reason: 'Fails IMEI check-digit (Luhn) validation' });
      } else if (existingSet.has(row.imei)) {
        errors.push({ row: row.rowNumber, imei: row.imei, reason: 'Already in the whitelist (this or another batch)' });
      } else if (seenInUpload.has(row.imei)) {
        errors.push({ row: row.rowNumber, imei: row.imei, reason: 'Duplicate row within this upload' });
      } else {
        seenInUpload.add(row.imei);
        toInsert.push(row);
      }
    }

    let inserted = [];
    if (toInsert.length > 0) {
      const values = [];
      const placeholders = toInsert.map((row, i) => {
        values.push(req.params.id, row.imei, row.mcuUid);
        const base = i * 3;
        return `($${base + 1}, $${base + 2}, $${base + 3})`;
      });
      const insertRes = await pool.query(
        `INSERT INTO agripump.batch_imeis (batch_id, imei, mcu_uid)
         VALUES ${placeholders.join(', ')}
         RETURNING id, imei, mcu_uid`,
        values
      );
      inserted = insertRes.rows;
    }

    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'batch', entityId: req.params.id,
      action: 'IMEI_IMPORT', after: { inserted_count: inserted.length, error_count: errors.length }, ip: req.ip
    });

    res.status(errors.length > 0 && inserted.length === 0 ? 400 : 201).json({
      message: `${inserted.length} IMEI(s) imported, ${errors.length} rejected`,
      inserted,
      errors
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/batches/:id/revoke', authenticateToken, requireRole(['superadmin']), async (req, res) => {
  try {
    const before = await pool.query(`SELECT id, revoked FROM agripump.device_batches WHERE id = $1`, [req.params.id]);
    if (before.rows.length === 0) return res.status(404).json({ error: 'Batch not found' });
    if (before.rows[0].revoked) {
      return res.status(409).json({ error: 'Batch is already revoked' });
    }

    const result = await pool.query(
      `UPDATE agripump.device_batches SET revoked = TRUE, revoked_at = CURRENT_TIMESTAMP WHERE id = $1
       RETURNING id, batch_code, revoked, revoked_at`,
      [req.params.id]
    );

    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'batch', entityId: req.params.id,
      action: 'REVOKE', before: before.rows[0], after: result.rows[0], ip: req.ip
    });

    res.json({ message: 'Batch revoked — unclaimed IMEIs in it can no longer be claimed', batch: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 4A4. POST /api/pumps/bulk-allocate: Bulk reassignment of pump ownership
//      (FR-WEB-013, FR-WEB-030 — "stock view + allocate to child nodes").
//      Reassigns each pump's owner_user_id and hierarchy_path to the target
//      account in one request instead of one PUT per device. A non-superadmin
//      caller may only allocate FROM pumps already in their own scope (the
//      same getPumpInScope rule every other pump route uses) and TO an
//      account that is themselves or a descendant in their own hierarchy —
//      "child nodes" per FR-WEB-030, enforced by the existing hierarchy_path
//      LIKE-prefix convention rather than a new depth counter. Every move is
//      written to `allocation_log`, the table that already exists
//      specifically for this (FR-SEC-003) — this is the first writer of it.
// ----------------------------------------------------------------------------
app.post(
  '/api/pumps/bulk-allocate',
  authenticateToken,
  requireRole(['superadmin', 'manufacturer', 'distributor', 'dealer']),
  async (req, res) => {
  try {
    const { pump_ids, to_user_id, note } = req.body;
    if (!Array.isArray(pump_ids) || pump_ids.length === 0) {
      return res.status(400).json({ error: 'pump_ids must be a non-empty array' });
    }
    if (!to_user_id) {
      return res.status(400).json({ error: 'to_user_id is required' });
    }

    const targetRes = await pool.query(`SELECT id, full_name, hierarchy_path FROM agripump.users WHERE id = $1`, [to_user_id]);
    if (targetRes.rows.length === 0) {
      return res.status(404).json({ error: 'Target account not found' });
    }
    const target = targetRes.rows[0];

    if (req.user.role !== 'superadmin' && !target.hierarchy_path.startsWith(req.user.hierarchy_path)) {
      return res.status(403).json({ error: 'Target account is outside your hierarchy — you may only allocate to yourself or a subordinate account' });
    }

    const results = [];
    for (const pumpId of pump_ids) {
      const pump = await getPumpInScope(pool, pumpId, req.user);
      if (!pump) {
        results.push({ pump_id: pumpId, success: false, reason: 'Not found or outside your scope' });
        continue;
      }

      await pool.query(
        `UPDATE agripump.pumps SET owner_user_id = $1, hierarchy_path = $2 WHERE id = $3`,
        [target.id, target.hierarchy_path, pump.id]
      );
      await pool.query(
        `INSERT INTO agripump.allocation_log (pump_id, from_user_id, to_user_id, actor_id, note)
         VALUES ($1, $2, $3, $4, $5)`,
        [pump.id, pump.owner_user_id, target.id, req.user.id, note || null]
      );

      const broadcastPump = await fetchPumpBroadcastRow(pool, pump.id);
      if (broadcastPump) broadcastPumpUpdate(broadcastPump);

      results.push({ pump_id: pumpId, success: true });
    }

    const allocatedCount = results.filter(r => r.success).length;
    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'allocation', entityId: target.id,
      action: 'BULK_ALLOCATE', after: { to_user_id: target.id, allocated_count: allocatedCount, failed_count: results.length - allocatedCount }, ip: req.ip
    });

    res.json({
      message: `${allocatedCount} device(s) allocated to ${target.full_name}, ${results.length - allocatedCount} failed`,
      results
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 4B. POST /api/pumps/:id/command: Dispatch START/STOP with a server-enforced
//     45s cooldown (SRS telemetry-and-fault-spec.md §2). The existing web UI
//     ran this cooldown as a client-side setTimeout only — nothing stopped a
//     second tab, a replayed request, or a modified client from issuing
//     commands every second. The cooldown is now authoritative here.
// ----------------------------------------------------------------------------
app.post(
  '/api/pumps/:id/command',
  authenticateToken,
  requireRole(['superadmin', 'manufacturer', 'distributor', 'dealer', 'customer']),
  async (req, res) => {
  try {
    const { action } = req.body;
    if (!['START', 'STOP'].includes(action)) {
      return res.status(400).json({ error: `action must be START or STOP` });
    }

    const pump = await getPumpInScope(pool, req.params.id, req.user);
    if (!pump) return res.status(404).json({ error: 'Pump device not found' });

    if (pump.last_command_at) {
      const elapsedSec = (Date.now() - new Date(pump.last_command_at).getTime()) / 1000;
      if (elapsedSec < COMMAND_COOLDOWN_SECONDS) {
        const remainingSec = Math.ceil(COMMAND_COOLDOWN_SECONDS - elapsedSec);
        return res.status(409).json({
          error: 'REJECTED / COOLDOWN_ACTIVE',
          remainingSec,
          message: `Command rejected: cooldown active for another ${remainingSec}s to protect the contactor from chatter.`
        });
      }
    }

    const expiresAt = new Date(Date.now() + COMMAND_EXPIRY_SECONDS * 1000);
    const cmdResult = await pool.query(
      `INSERT INTO agripump.commands (pump_id, actor_id, action, status, expires_at)
       VALUES ($1, $2, $3, 'PENDING', $4)
       RETURNING cid, pump_id, action, status, issued_at, expires_at`,
      [pump.id, req.user.id, action, expiresAt]
    );

    await pool.query(`UPDATE agripump.pumps SET last_command_at = CURRENT_TIMESTAMP WHERE id = $1`, [pump.id]);

    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'pump', entityId: pump.id,
      action: `COMMAND_${action}`, after: cmdResult.rows[0], ip: req.ip
    });

    res.status(202).json({
      message: `${action} command queued`,
      command: cmdResult.rows[0],
      cooldownSec: COMMAND_COOLDOWN_SECONDS
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 4C. GET /api/pumps/:id/telemetry: Time-series read-back (backs the Trends
//     tab). telemetry_history has been written since v1 but nothing ever
//     read it.
// ----------------------------------------------------------------------------
app.get('/api/pumps/:id/telemetry', authenticateToken, async (req, res) => {
  try {
    const pump = await getPumpInScope(pool, req.params.id, req.user);
    if (!pump) return res.status(404).json({ error: 'Pump device not found' });

    const limit = Math.min(parseInt(req.query.limit) || 200, 2000);
    const hours = Math.min(parseInt(req.query.hours) || 24 * 30, 24 * 30); // SRS §12.7 — 30-day raw retention window

    const result = await pool.query(
      `SELECT recorded_at, v_ry, v_yb, v_br, i_r, i_y, i_b, gsm_rssi, pump_on, fault_active, seq, ts_approx, buffered
       FROM agripump.telemetry_history
       WHERE pump_id = $1 AND recorded_at > CURRENT_TIMESTAMP - ($2 || ' hours')::interval
       ORDER BY recorded_at DESC
       LIMIT $3`,
      [pump.id, hours, limit]
    );

    res.json({ pump_id: pump.id, count: result.rows.length, telemetry: result.rows.reverse() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 4D. GET /api/pumps/:id/faults: Fault log read-back (backs the Events tab
//     and the Fault Incident Logs tab, both of which were hard-coded HTML).
// ----------------------------------------------------------------------------
app.get('/api/pumps/:id/faults', authenticateToken, async (req, res) => {
  try {
    const pump = await getPumpInScope(pool, req.params.id, req.user);
    if (!pump) return res.status(404).json({ error: 'Pump device not found' });

    const onlyOpen = req.query.open === 'true';
    const limit = Math.min(parseInt(req.query.limit) || 100, 1000);

    let queryText = `
      SELECT fl.id, fl.pump_id, fl.occurred_at, fl.fault_code, fcc.name as fault_name, fcc.severity,
             fl.description, fl.v_yb_snapshot, fl.contactor_tripped, fl.alert_sent_sms, fl.alert_sent_whatsapp,
             fl.ack_by_user_id, fl.ack_at, fl.resolved_at
      FROM agripump.fault_logs fl
      LEFT JOIN agripump.fault_code_catalog fcc ON fcc.code = fl.fault_code
      WHERE fl.pump_id = $1`;
    const params = [pump.id];
    if (onlyOpen) queryText += ` AND fl.resolved_at IS NULL`;
    queryText += ` ORDER BY fl.occurred_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(queryText, params);
    res.json({ pump_id: pump.id, count: result.rows.length, faults: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 4E. POST /api/pumps/:id/faults/:faultId/ack: Acknowledge / resolve a fault
//     (permission matrix: Superadmin/PM/Distributor/Dealer full, End User
//     own-device only — SRS §7.2 "Reset fault" row).
// ----------------------------------------------------------------------------
app.post('/api/pumps/:id/faults/:faultId/ack', authenticateToken, async (req, res) => {
  try {
    const pump = await getPumpInScope(pool, req.params.id, req.user);
    if (!pump) return res.status(404).json({ error: 'Pump device not found' });

    const resolve = req.body.resolve === true;
    const result = await pool.query(
      `UPDATE agripump.fault_logs
       SET ack_by_user_id = $1, ack_at = CURRENT_TIMESTAMP, resolved_at = CASE WHEN $2 THEN CURRENT_TIMESTAMP ELSE resolved_at END
       WHERE id = $3 AND pump_id = $4
       RETURNING *`,
      [req.user.id, resolve, req.params.faultId, pump.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Fault log entry not found for this pump' });

    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'fault_log', entityId: String(req.params.faultId),
      action: resolve ? 'RESOLVE_FAULT' : 'ACK_FAULT', after: result.rows[0], ip: req.ip
    });

    const catalog = await pool.query(`SELECT name, severity FROM agripump.fault_code_catalog WHERE code = $1`, [result.rows[0].fault_code]);
    broadcastFault(pump.id, pump.hierarchy_path, {
      ...result.rows[0],
      fault_name: catalog.rows[0]?.name || null,
      severity: catalog.rows[0]?.severity || null
    });

    res.json({ message: 'Fault updated', fault: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 4E2. Alert engine — FR-WEB-060/062/063, scoped down per product-owner
//     direction (in-app delivery only, see services/alertEngine.js header).
//     List/ack/assign/resolve are scoped by joining to pumps exactly like
//     every other list endpoint (hierarchy_path LIKE-prefix); subscriptions
//     are always the caller's own rows, no cross-user access.
// ----------------------------------------------------------------------------
app.get('/api/alerts', authenticateToken, async (req, res) => {
  try {
    const parentPath = req.user.role === 'superadmin' ? (req.query.hierarchy_path || ROOT_HIERARCHY_PATH) : (req.user.hierarchy_path || ROOT_HIERARCHY_PATH);
    const { status, severity, pump_id } = req.query;

    const conditions = [`p.hierarchy_path LIKE $1 || '%'`];
    const params = [parentPath];
    if (status === 'open') conditions.push(`a.resolved_at IS NULL`);
    else if (status === 'acknowledged') conditions.push(`a.acknowledged_at IS NOT NULL AND a.resolved_at IS NULL`);
    else if (status === 'resolved') conditions.push(`a.resolved_at IS NOT NULL`);
    if (severity) {
      params.push(severity);
      conditions.push(`a.severity = $${params.length}`);
    }
    if (pump_id) {
      params.push(pump_id);
      conditions.push(`a.pump_id = $${params.length}`);
    }

    const result = await pool.query(
      `SELECT a.*, p.name AS pump_name, fcc.name AS fault_name,
              ack.full_name AS acknowledged_by_name,
              assignee.full_name AS assigned_to_name
       FROM agripump.alerts a
       JOIN agripump.pumps p ON p.id = a.pump_id
       LEFT JOIN agripump.fault_code_catalog fcc ON fcc.code = a.fault_code
       LEFT JOIN agripump.users ack ON ack.id = a.acknowledged_by
       LEFT JOIN agripump.users assignee ON assignee.id = a.assigned_to
       WHERE ${conditions.join(' AND ')}
       ORDER BY a.last_occurred_at DESC
       LIMIT 200`,
      params
    );
    res.json({ alerts: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function getAlertInScope(client, alertId, user) {
  const result = await client.query(
    `SELECT a.*, p.hierarchy_path FROM agripump.alerts a JOIN agripump.pumps p ON p.id = a.pump_id WHERE a.id = $1`,
    [alertId]
  );
  if (result.rows.length === 0) return null;
  const alert = result.rows[0];
  if (user.role === 'superadmin') return alert;
  const userPath = user.hierarchy_path || ROOT_HIERARCHY_PATH;
  if (!alert.hierarchy_path.startsWith(userPath)) return null;
  return alert;
}

app.post('/api/alerts/:id/ack', authenticateToken, async (req, res) => {
  try {
    const alert = await getAlertInScope(pool, req.params.id, req.user);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });

    const result = await pool.query(
      `UPDATE agripump.alerts SET acknowledged_by = $1, acknowledged_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [req.user.id, alert.id]
    );
    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'alert', entityId: alert.id,
      action: 'ACK', after: result.rows[0], ip: req.ip
    });
    res.json({ message: 'Alert acknowledged', alert: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/alerts/:id/assign', authenticateToken, async (req, res) => {
  try {
    const alert = await getAlertInScope(pool, req.params.id, req.user);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });

    const { assignee_user_id } = req.body;
    if (!assignee_user_id) return res.status(400).json({ error: 'assignee_user_id is required' });

    const assigneeRes = await pool.query(`SELECT id, hierarchy_path FROM agripump.users WHERE id = $1`, [assignee_user_id]);
    const assignee = assigneeRes.rows[0];
    const callerPath = req.user.hierarchy_path || ROOT_HIERARCHY_PATH;
    if (!assignee || (req.user.role !== 'superadmin' && !assignee.hierarchy_path.startsWith(callerPath))) {
      return res.status(400).json({ error: 'assignee_user_id must be an account within your own hierarchy scope' });
    }

    const result = await pool.query(`UPDATE agripump.alerts SET assigned_to = $1 WHERE id = $2 RETURNING *`, [assignee_user_id, alert.id]);
    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'alert', entityId: alert.id,
      action: 'ASSIGN', after: result.rows[0], ip: req.ip
    });
    res.json({ message: 'Alert assigned', alert: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/alerts/:id/resolve', authenticateToken, async (req, res) => {
  try {
    const alert = await getAlertInScope(pool, req.params.id, req.user);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });

    const result = await pool.query(
      `UPDATE agripump.alerts SET resolved_at = CURRENT_TIMESTAMP, resolution_note = $1 WHERE id = $2 RETURNING *`,
      [req.body.resolution_note || null, alert.id]
    );
    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'alert', entityId: alert.id,
      action: 'RESOLVE', after: result.rows[0], ip: req.ip
    });
    res.json({ message: 'Alert resolved', alert: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// FR-WEB-060 — a user's own subscription rows. No rows at all = subscribed
// to everything in their own hierarchy scope by default (see the
// schema.sql §16 comment); rows here only narrow or mute.
app.get('/api/alert-subscriptions', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM agripump.alert_subscriptions WHERE user_id = $1 ORDER BY created_at DESC`, [req.user.id]);
    res.json({ subscriptions: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/alert-subscriptions', authenticateToken, async (req, res) => {
  try {
    const { pump_id, alert_type, min_severity, muted } = req.body;
    if (pump_id) {
      const pump = await getPumpInScope(pool, pump_id, req.user);
      if (!pump) return res.status(404).json({ error: 'Pump device not found' });
    }
    const result = await pool.query(
      `INSERT INTO agripump.alert_subscriptions (user_id, pump_id, alert_type, min_severity, muted)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, pump_id || null, alert_type || null, min_severity || null, muted === true]
    );
    res.status(201).json({ message: 'Subscription created', subscription: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/alert-subscriptions/:id', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM agripump.alert_subscriptions WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Subscription not found' });
    res.json({ message: 'Subscription deleted', deleted_id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 4F. GET/PUT /api/pumps/:id/config: Desired vs. reported configuration
//     (SRS §6.4). PUT sets `desired`; the device (or simulator) closes the
//     loop via POST /api/devices/:id/config/report below.
// ----------------------------------------------------------------------------
app.get('/api/pumps/:id/config', authenticateToken, async (req, res) => {
  try {
    const pump = await getPumpInScope(pool, req.params.id, req.user);
    if (!pump) return res.status(404).json({ error: 'Pump device not found' });

    const result = await pool.query(`SELECT * FROM agripump.device_config WHERE pump_id = $1`, [pump.id]);
    res.json({ pump_id: pump.id, config: result.rows[0] || { pump_id: pump.id, desired_json: {}, reported_json: {}, status: 'PENDING' } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put(
  '/api/pumps/:id/config',
  authenticateToken,
  requireRole(['superadmin', 'manufacturer', 'distributor', 'dealer']),
  async (req, res) => {
  try {
    const pump = await getPumpInScope(pool, req.params.id, req.user);
    if (!pump) return res.status(404).json({ error: 'Pump device not found' });

    const { desired } = req.body;
    if (!desired || typeof desired !== 'object') {
      return res.status(400).json({ error: 'desired (object) is required — the layer-A key set from SRS §6.1' });
    }

    const result = await pool.query(
      `INSERT INTO agripump.device_config (pump_id, desired_json, status, updated_by, updated_at)
       VALUES ($1, $2, 'PENDING', $3, CURRENT_TIMESTAMP)
       ON CONFLICT (pump_id) DO UPDATE SET desired_json = EXCLUDED.desired_json, status = 'PENDING', updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [pump.id, JSON.stringify(desired), req.user.id]
    );

    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'device_config', entityId: pump.id,
      action: 'SET_DESIRED_CONFIG', after: result.rows[0], ip: req.ip
    });

    res.json({ message: 'Desired configuration set (pending device acknowledgement)', config: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 4G. Configuration Templates — FR-WEB-032. A named, reusable set of
//     layer-A desired-config keys, scoped by the creator's own
//     hierarchy_path (same LIKE-prefix convention as GET /api/pumps —
//     caller sees templates they or anyone in their subtree created).
// ----------------------------------------------------------------------------
app.post(
  '/api/config-templates',
  authenticateToken,
  requireRole(['superadmin', 'manufacturer', 'distributor', 'dealer']),
  async (req, res) => {
  try {
    const { name, description, desired_json } = req.body;
    if (!name || !desired_json || typeof desired_json !== 'object') {
      return res.status(400).json({ error: 'name and desired_json (object) are required' });
    }

    const result = await pool.query(
      `INSERT INTO agripump.config_templates (name, description, desired_json, owner_user_id, owner_hierarchy_path, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name.trim(), description ? description.trim() : null, JSON.stringify(desired_json), req.user.id, req.user.hierarchy_path, req.user.id]
    );

    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'config_template', entityId: result.rows[0].id,
      action: 'CREATE', after: result.rows[0], ip: req.ip
    });

    res.status(201).json({ message: 'Template created', template: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/config-templates', authenticateToken, async (req, res) => {
  try {
    const path = req.user.role === 'superadmin' ? ROOT_HIERARCHY_PATH : (req.user.hierarchy_path || ROOT_HIERARCHY_PATH);
    const result = await pool.query(
      `SELECT * FROM agripump.config_templates WHERE owner_hierarchy_path LIKE $1 || '%' ORDER BY created_at DESC`,
      [path]
    );
    res.json({ templates: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function getTemplateInScope(client, templateId, user) {
  const result = await client.query(`SELECT * FROM agripump.config_templates WHERE id = $1`, [templateId]);
  if (result.rows.length === 0) return null;
  const template = result.rows[0];
  if (user.role === 'superadmin') return template;
  const userPath = user.hierarchy_path || ROOT_HIERARCHY_PATH;
  if (!template.owner_hierarchy_path.startsWith(userPath)) return null;
  return template;
}

app.put(
  '/api/config-templates/:id',
  authenticateToken,
  requireRole(['superadmin', 'manufacturer', 'distributor', 'dealer']),
  async (req, res) => {
  try {
    const template = await getTemplateInScope(pool, req.params.id, req.user);
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const { name, description, desired_json } = req.body;
    const result = await pool.query(
      `UPDATE agripump.config_templates SET name = $1, description = $2, desired_json = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 RETURNING *`,
      [name ? name.trim() : template.name, description !== undefined ? description : template.description, JSON.stringify(desired_json || template.desired_json), template.id]
    );

    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'config_template', entityId: template.id,
      action: 'UPDATE', before: template, after: result.rows[0], ip: req.ip
    });

    res.json({ message: 'Template updated', template: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete(
  '/api/config-templates/:id',
  authenticateToken,
  requireRole(['superadmin', 'manufacturer', 'distributor', 'dealer']),
  async (req, res) => {
  try {
    const template = await getTemplateInScope(pool, req.params.id, req.user);
    if (!template) return res.status(404).json({ error: 'Template not found' });

    await pool.query(`DELETE FROM agripump.config_templates WHERE id = $1`, [template.id]);
    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'config_template', entityId: template.id,
      action: 'DELETE', before: template, ip: req.ip
    });

    res.json({ message: 'Template deleted', deleted_id: template.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/config-templates/:id/apply — MERGES the template's keys into
// each target pump's EXISTING desired_json rather than replacing it
// wholesale (see the schema comment on config_templates and the
// device_config_full_replace_gotcha note: PUT /api/pumps/:id/config
// replaces desired_json entirely, so applying a template naively would
// erase whatever else was set on that pump).
app.post(
  '/api/config-templates/:id/apply',
  authenticateToken,
  requireRole(['superadmin', 'manufacturer', 'distributor', 'dealer']),
  async (req, res) => {
  try {
    const template = await getTemplateInScope(pool, req.params.id, req.user);
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const { pump_ids } = req.body;
    if (!Array.isArray(pump_ids) || pump_ids.length === 0) {
      return res.status(400).json({ error: 'pump_ids must be a non-empty array' });
    }

    const results = [];
    for (const pumpId of pump_ids) {
      const pump = await getPumpInScope(pool, pumpId, req.user);
      if (!pump) {
        results.push({ pump_id: pumpId, success: false, reason: 'Not found or outside your scope' });
        continue;
      }

      const existing = await pool.query(`SELECT desired_json FROM agripump.device_config WHERE pump_id = $1`, [pump.id]);
      const merged = { ...(existing.rows[0]?.desired_json || {}), ...template.desired_json };

      await pool.query(
        `INSERT INTO agripump.device_config (pump_id, desired_json, status, updated_by, updated_at)
         VALUES ($1, $2, 'PENDING', $3, CURRENT_TIMESTAMP)
         ON CONFLICT (pump_id) DO UPDATE SET desired_json = EXCLUDED.desired_json, status = 'PENDING', updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
        [pump.id, JSON.stringify(merged), req.user.id]
      );

      results.push({ pump_id: pumpId, success: true });
    }

    const appliedCount = results.filter(r => r.success).length;
    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'config_template', entityId: template.id,
      action: 'APPLY', after: { applied_count: appliedCount, failed_count: results.length - appliedCount, pump_ids }, ip: req.ip
    });

    res.json({ message: `Applied to ${appliedCount} device(s), ${results.length - appliedCount} failed`, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 5. POST /api/telemetry: Ingest 4G Cellular Telemetry Packet
//
// SEC-1 FIX: this endpoint used to accept telemetry for ANY pump_id with no
// authentication at all — anyone reachable could fabricate a pump's status
// or history. It now requires an X-Device-Key header matching the target
// pump's stored key (authenticateDevice middleware).
// ----------------------------------------------------------------------------
app.post(
  '/api/telemetry',
  authenticateDevice((req) => req.body && req.body.pump_id),
  async (req, res) => {
  try {
    const { pump_id, v_ry, v_yb, v_br, i_r, i_y, i_b, gsm_rssi, pump_on, fault_active, fault_code, fault_description, seq, ts_approx } = req.body;

    await pool.query(
      `INSERT INTO agripump.telemetry_history (pump_id, v_ry, v_yb, v_br, i_r, i_y, i_b, gsm_rssi, pump_on, fault_active, seq, ts_approx)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [pump_id, v_ry, v_yb, v_br, i_r, i_y, i_b, gsm_rssi ?? null, !!pump_on, !!fault_active, seq ?? null, !!ts_approx]
    );

    const status = fault_active ? 'FAULT' : (pump_on ? 'RUNNING' : 'STOPPED');
    await pool.query(
      `UPDATE agripump.pumps SET status = $1, last_seen_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [status, pump_id]
    );

    let faultLogId = null;
    if (fault_active && fault_code !== undefined && fault_code !== null) {
      const faultRes = await pool.query(
        `INSERT INTO agripump.fault_logs (pump_id, fault_code, description, v_yb_snapshot, contactor_tripped)
         VALUES ($1, $2, $3, $4, TRUE)
         RETURNING id, pump_id, occurred_at, fault_code, description, v_yb_snapshot, contactor_tripped`,
        [pump_id, fault_code, fault_description || 'Fault reported by device', v_yb ?? null]
      );
      faultLogId = faultRes.rows[0].id;

      const broadcastPump = await fetchPumpBroadcastRow(pool, pump_id);
      if (broadcastPump) {
        const catalog = await pool.query(`SELECT name, severity FROM agripump.fault_code_catalog WHERE code = $1`, [fault_code]);
        const severity = catalog.rows[0]?.severity || 'LOW';
        broadcastFault(pump_id, broadcastPump.hierarchy_path, {
          ...faultRes.rows[0],
          fault_name: catalog.rows[0]?.name || null,
          severity
        });

        // FR-WEB-060/062 alert engine — formalizes the raw fault broadcast
        // above into a deduplicated, subscription-filtered alert. Only
        // deliver on a genuinely new occurrence, not on a dedup bump, or a
        // repeating fault would re-notify every single time it recurs.
        const { alert, isNewOccurrence } = await raiseAlert(pool, {
          pumpId: pump_id,
          alertType: 'FAULT',
          severity,
          faultCode: fault_code,
          sourceFaultLogId: faultLogId
        });
        if (isNewOccurrence) await deliverAlert(pool, alert);
      }
    }

    const broadcastPump = await fetchPumpBroadcastRow(pool, pump_id);
    if (broadcastPump) broadcastPumpUpdate(broadcastPump);

    metrics.increment('telemetry_ingest_success');
    res.json({ status: 'SUCCESS', pump_id, status_updated: status, fault_log_id: faultLogId });
  } catch (err) {
    metrics.increment('telemetry_ingest_failure');
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 5B. GET /api/devices/:id/commands/pending: Device-side command polling.
//     Lazily expires anything past its expiry on the way out, so a device
//     that never checks in doesn't leave a stale PENDING row forever.
// ----------------------------------------------------------------------------
app.get(
  '/api/devices/:id/commands/pending',
  authenticateDevice((req) => req.params.id),
  async (req, res) => {
  try {
    await pool.query(
      `UPDATE agripump.commands SET status = 'EXPIRED' WHERE pump_id = $1 AND status = 'PENDING' AND expires_at < CURRENT_TIMESTAMP`,
      [req.pumpId]
    );
    const result = await pool.query(
      `SELECT cid, action, issued_at, expires_at FROM agripump.commands WHERE pump_id = $1 AND status = 'PENDING' ORDER BY issued_at ASC`,
      [req.pumpId]
    );
    res.json({ pump_id: req.pumpId, commands: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 5C. POST /api/devices/:id/commands/:cid/ack: Device confirms a command was
//     applied (or rejects it — e.g. fault active, per FR-DEV-049).
// ----------------------------------------------------------------------------
app.post(
  '/api/devices/:id/commands/:cid/ack',
  authenticateDevice((req) => req.params.id),
  async (req, res) => {
  try {
    const { ok, reason } = req.body;
    const status = ok === false ? 'REJECTED' : 'ACKED';

    const result = await pool.query(
      `UPDATE agripump.commands SET status = $1, acked_at = CURRENT_TIMESTAMP, reject_reason = $2
       WHERE cid = $3 AND pump_id = $4 AND status = 'PENDING'
       RETURNING *`,
      [status, reason || null, req.params.cid, req.pumpId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No matching PENDING command for that cid/pump_id (already acked, expired, or unknown)' });
    }

    if (status === 'ACKED') {
      const newPumpStatus = result.rows[0].action === 'START' ? 'RUNNING' : 'STOPPED';
      await pool.query(`UPDATE agripump.pumps SET status = $1, last_seen_at = CURRENT_TIMESTAMP WHERE id = $2`, [newPumpStatus, req.pumpId]);
      const broadcastPump = await fetchPumpBroadcastRow(pool, req.pumpId);
      if (broadcastPump) broadcastPumpUpdate(broadcastPump);
    }

    res.json({ message: `Command ${status.toLowerCase()}`, command: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 5D. POST /api/devices/:id/config/report: Device echoes its actual applied
//     configuration (closes the desired/reported loop from §6.4, standing in
//     for `get_settings` — SRS FR-CON-031 — until the real firmware has it).
// ----------------------------------------------------------------------------
app.post(
  '/api/devices/:id/config/report',
  authenticateDevice((req) => req.params.id),
  async (req, res) => {
  try {
    const { reported } = req.body;
    if (!reported || typeof reported !== 'object') {
      return res.status(400).json({ error: 'reported (object) is required' });
    }
    const result = await pool.query(
      `INSERT INTO agripump.device_config (pump_id, reported_json, status, updated_at)
       VALUES ($1, $2, 'APPLIED', CURRENT_TIMESTAMP)
       ON CONFLICT (pump_id) DO UPDATE SET reported_json = EXCLUDED.reported_json, status = 'APPLIED', updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [req.pumpId, JSON.stringify(reported)]
    );

    const pumpRow = await pool.query(`SELECT hierarchy_path FROM agripump.pumps WHERE id = $1`, [req.pumpId]);
    if (pumpRow.rows[0]) broadcastConfigUpdate(req.pumpId, pumpRow.rows[0].hierarchy_path, result.rows[0]);

    res.json({ message: 'Reported configuration recorded', config: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 6. POST /api/users: Create Subordinate User Account
//
// Fixed from v1: the role allowlist used to be a literal (and buggy) list
// ['superadmin','manufacturer','distributor','dealer1','dealer5'] that left
// dealer2/3/4 unable to create subordinates. The single 'dealer' role makes
// that class of bug structurally impossible. Depth (FR-SEC-000a/b) and
// role-assignment permission (who may create whom) are now both enforced
// server-side rather than left to client-side UI hints.
// ----------------------------------------------------------------------------
app.post(
  '/api/users',
  authenticateToken,
  requireRole(['superadmin', 'manufacturer', 'distributor', 'dealer']),
  async (req, res) => {
  try {
    const { full_name, phone_number, role, parent_user_id, parent_hierarchy_path, preferred_language, password, membership, org_role } = req.body;

    if (!full_name || !phone_number) {
      return res.status(400).json({ error: 'full_name and phone_number are required' });
    }

    // ------------------------------------------------------------------
    // P-1 (Web_App_Pending_Items.md §8.1.2) — membership: 'staff' adds a
    // colleague to an EXISTING org node: same role, same hierarchy_path
    // (verbatim, not appended — a new branch here would give the new
    // login its own empty subtree and zero visible devices), same
    // dealer_depth (a colleague isn't another rung on the dealer ladder).
    // Gated on being the org's owner, not on ASSIGNABLE_ROLES — adding a
    // peer is a different operation from creating a subordinate tier.
    // ------------------------------------------------------------------
    if (membership === 'staff') {
      if (!parent_user_id) {
        return res.status(400).json({ error: 'parent_user_id (the org node to add staff to) is required for membership=staff' });
      }
      const orgRes = await pool.query(
        `SELECT id, role, hierarchy_path, dealer_depth, org_node_id FROM agripump.users WHERE id = $1`,
        [parent_user_id]
      );
      if (orgRes.rows.length === 0) return res.status(404).json({ error: 'Target organisation account not found' });
      const orgOwner = orgRes.rows[0];
      const orgRootId = orgOwner.org_node_id || orgOwner.id;

      if (req.user.role !== 'superadmin' && req.user.id !== orgRootId) {
        return res.status(403).json({ error: 'Only the organisation owner (or Superadmin) may add staff to this account' });
      }
      // P-1 was scoped to manufacturer/distributor/dealer partner
      // organisations having employees — an end customer is a single
      // person with a single pump, not an org with colleagues to add.
      if (orgOwner.role === 'customer') {
        return res.status(400).json({ error: 'End customer accounts do not support staff/multiple logins' });
      }

      const staffRole = org_role === 'readonly' ? 'readonly' : 'staff';
      const newIdRes = await pool.query(`SELECT public.uuid_generate_v4() as new_id`);
      const newId = newIdRes.rows[0].new_id;
      const passHash = password ? hashSecret(password) : null;

      const result = await pool.query(
        `INSERT INTO agripump.users (id, full_name, phone_number, role, hierarchy_path, parent_user_id, dealer_depth, preferred_language, password_hash, org_node_id, org_role)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, full_name, role, hierarchy_path, dealer_depth, org_node_id, org_role`,
        [newId, full_name.trim(), phone_number.trim(), orgOwner.role, orgOwner.hierarchy_path, orgRootId, orgOwner.dealer_depth, preferred_language || 'en', passHash, orgRootId, staffRole]
      );

      await writeAudit(pool, {
        actorId: req.user.id, actorRole: req.user.role, entityType: 'user', entityId: newId,
        action: 'CREATE_STAFF', after: result.rows[0], ip: req.ip
      });

      return res.status(201).json({ message: 'Staff account created', user: result.rows[0] });
    }

    if (!role) {
      return res.status(400).json({ error: 'role is required' });
    }
    if (!canAssignRole(req.user.role, role)) {
      return res.status(403).json({
        error: `Permission Denied: role '${req.user.role}' cannot create a subordinate with role '${role}'. Assignable roles: [${(ASSIGNABLE_ROLES[req.user.role] || []).join(', ')}]`
      });
    }

    const parentId = parent_user_id || req.user.id;
    const dealerDepth = await computeDealerDepth(pool, parentId, role);
    if (dealerDepth > 6) {
      return res.status(400).json({
        error: `Rejected: dealer nesting depth limit is 6 levels below a distributor (FR-SEC-000a). This request would create depth ${dealerDepth}.`
      });
    }

    const userRes = await pool.query(`SELECT public.uuid_generate_v4() as new_id`);
    const newId = userRes.rows[0].new_id;
    const parentPath = parent_hierarchy_path || req.user.hierarchy_path || ROOT_HIERARCHY_PATH;
    const newPath = `${parentPath}/${newId}`;
    const passHash = password ? hashSecret(password) : null;

    const result = await pool.query(
      `INSERT INTO agripump.users (id, full_name, phone_number, role, hierarchy_path, parent_user_id, dealer_depth, preferred_language, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, full_name, role, hierarchy_path, dealer_depth`,
      [newId, full_name.trim(), phone_number.trim(), role, newPath, parentId, dealerDepth, preferred_language || 'en', passHash]
    );

    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'user', entityId: newId,
      action: 'CREATE_SUBORDINATE', after: result.rows[0], ip: req.ip
    });

    res.status(201).json({ message: 'Subordinate user created', user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') { // unique_violation on phone_number
      return res.status(409).json({ error: 'A user with that phone number already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 6A. POST /api/invites: Create a child-org invite link (FR-WEB-035).
//     Same role-assignment/depth rules as POST /api/users above — an
//     invite pre-commits to a role, it doesn't loosen who may grant it.
//     Re-checked at redemption too, since the parent's own depth could
//     change between invite creation and someone actually using the link.
// ----------------------------------------------------------------------------
app.post(
  '/api/invites',
  authenticateToken,
  requireRole(['superadmin', 'manufacturer', 'distributor', 'dealer']),
  async (req, res) => {
  try {
    const { role, parent_user_id } = req.body;
    if (!role) return res.status(400).json({ error: 'role is required' });
    // Invite links are self-service registration by design — unlike
    // POST /api/users (where a superadmin types the new account in
    // themselves), nobody vets who clicks the link. Minting a superadmin
    // from an unattended link is a materially different risk than a
    // superadmin creating one by hand, so it's excluded here even though
    // ASSIGNABLE_ROLES.superadmin otherwise permits it (mirrors the
    // invite_tokens table's own role CHECK constraint).
    if (role === 'superadmin') {
      return res.status(403).json({ error: 'Superadmin accounts cannot be created via invite link' });
    }
    if (!canAssignRole(req.user.role, role)) {
      return res.status(403).json({
        error: `Permission Denied: role '${req.user.role}' cannot invite a '${role}'. Assignable roles: [${(ASSIGNABLE_ROLES[req.user.role] || []).join(', ')}]`
      });
    }

    const parentId = parent_user_id || req.user.id;
    let parentHierarchyPath = req.user.hierarchy_path || ROOT_HIERARCHY_PATH;
    if (parent_user_id && parent_user_id !== req.user.id) {
      const parentRes = await pool.query(`SELECT hierarchy_path FROM agripump.users WHERE id = $1`, [parent_user_id]);
      if (parentRes.rows.length === 0) return res.status(404).json({ error: 'Parent account not found' });
      parentHierarchyPath = parentRes.rows[0].hierarchy_path;
    }

    const dealerDepth = await computeDealerDepth(pool, parentId, role);
    if (dealerDepth > 6) {
      return res.status(400).json({ error: `Rejected: dealer nesting depth limit is 6 levels below a distributor (FR-SEC-000a). This invite would create depth ${dealerDepth}.` });
    }

    const rawToken = crypto.randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const result = await pool.query(
      `INSERT INTO agripump.invite_tokens (token_hash, role, parent_user_id, parent_hierarchy_path, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, role, expires_at`,
      [hashRefreshToken(rawToken), role, parentId, parentHierarchyPath, req.user.id, expiresAt]
    );

    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'invite', entityId: result.rows[0].id,
      action: 'CREATE_INVITE', after: { role, parent_user_id: parentId, expires_at: expiresAt }, ip: req.ip
    });

    res.status(201).json({ message: 'Invite created', token: rawToken, role, expires_at: result.rows[0].expires_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 6B. POST /api/invites/:token/redeem: Public — the invited person
//     registers themselves and is logged in immediately. No auth on this
//     route by design (nobody has an account yet); the token itself is the
//     credential, and it's single-use and time-limited.
// ----------------------------------------------------------------------------
app.post(
  '/api/invites/:token/redeem',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyFn: req => req.ip }),
  async (req, res) => {
  try {
    const { full_name, phone_number, password } = req.body;
    if (!full_name || !phone_number) {
      return res.status(400).json({ error: 'full_name and phone_number are required' });
    }

    const tokenHash = hashRefreshToken(req.params.token);
    const inviteRes = await pool.query(`SELECT * FROM agripump.invite_tokens WHERE token_hash = $1`, [tokenHash]);
    if (inviteRes.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid invite link' });
    }
    const invite = inviteRes.rows[0];
    if (invite.used_at) {
      return res.status(410).json({ error: 'This invite link has already been used' });
    }
    if (new Date(invite.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This invite link has expired' });
    }

    const dealerDepth = await computeDealerDepth(pool, invite.parent_user_id, invite.role);
    if (dealerDepth > 6) {
      return res.status(400).json({ error: 'Rejected: dealer nesting depth limit is 6 levels below a distributor (FR-SEC-000a)' });
    }

    const newIdRes = await pool.query(`SELECT public.uuid_generate_v4() as new_id`);
    const newId = newIdRes.rows[0].new_id;
    const newPath = `${invite.parent_hierarchy_path}/${newId}`;
    const passHash = password ? hashSecret(password) : null;

    const userRes = await pool.query(
      `INSERT INTO agripump.users (id, full_name, phone_number, role, hierarchy_path, parent_user_id, dealer_depth, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, full_name, phone_number, role, hierarchy_path, totp_enabled, account_status`,
      [newId, full_name.trim(), phone_number.trim(), invite.role, newPath, invite.parent_user_id, dealerDepth, passHash]
    );
    const newUser = userRes.rows[0];

    await pool.query(`UPDATE agripump.invite_tokens SET used_at = CURRENT_TIMESTAMP, used_by_user_id = $1 WHERE id = $2`, [newId, invite.id]);

    await writeAudit(pool, {
      actorId: newId, actorRole: invite.role, entityType: 'user', entityId: newId,
      action: 'REDEEM_INVITE', after: { id: newId, role: invite.role, invited_by: invite.created_by }, ip: req.ip
    });

    await finishAuth(res, newUser, 'Account created — welcome to AgriPump SmartSpace');
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A user with that phone number already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// ----------------------------------------------------------------------------
// 6D. GET /api/branding/resolve: The branding that should apply to the
//     caller right now (FR-WEB-036, Web_App_Pending_Items.md §8.1).
//     Branding attaches to a manufacturer's own node; anyone under them —
//     distributor, dealer, customer — inherits it by walking UP their own
//     hierarchy_path to the nearest ancestor (including themselves) that
//     has a branding row. No row anywhere in the chain means null, and
//     the frontend renders its own default theme — never a fabricated
//     placeholder brand.
// ----------------------------------------------------------------------------
app.get('/api/branding/resolve', authenticateToken, async (req, res) => {
  try {
    const path = req.user.hierarchy_path || ROOT_HIERARCHY_PATH;
    const ancestorIds = path.split('/').filter(Boolean).reverse(); // self-first
    if (ancestorIds.length === 0) return res.json({ branding: null });

    const result = await pool.query(
      `SELECT logo_url, primary_color, notification_sender_name, subdomain
       FROM agripump.branding
       WHERE user_id = ANY($1::uuid[])
       ORDER BY array_position($1::uuid[], user_id)
       LIMIT 1`,
      [ancestorIds]
    );

    res.json({ branding: result.rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function getBranding(userId) {
  const result = await pool.query(
    `SELECT user_id, logo_url, primary_color, notification_sender_name, subdomain, updated_at FROM agripump.branding WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function upsertBranding(client, { userId, logoUrl, primaryColor, senderName, subdomain, actorId }) {
  if (!primaryColor || !HEX_COLOR_RE.test(primaryColor)) {
    throw Object.assign(new Error('primary_color must be a 6-digit hex value like #0B5FA5'), { status: 400 });
  }
  const result = await client.query(
    `INSERT INTO agripump.branding (user_id, logo_url, primary_color, notification_sender_name, subdomain, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id) DO UPDATE SET
       logo_url = EXCLUDED.logo_url, primary_color = EXCLUDED.primary_color,
       notification_sender_name = EXCLUDED.notification_sender_name, subdomain = EXCLUDED.subdomain,
       updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP
     RETURNING user_id, logo_url, primary_color, notification_sender_name, subdomain, updated_at`,
    [userId, logoUrl || null, primaryColor, senderName || null, subdomain || null, actorId]
  );
  return result.rows[0];
}

// ----------------------------------------------------------------------------
// 6E. GET/PUT /api/branding/mine: Manufacturer self-service branding.
// ----------------------------------------------------------------------------
app.get('/api/branding/mine', authenticateToken, requireRole(['manufacturer']), async (req, res) => {
  try {
    res.json({ branding: await getBranding(req.user.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/branding/mine', authenticateToken, requireRole(['manufacturer']), async (req, res) => {
  try {
    const { logo_url, primary_color, notification_sender_name, subdomain } = req.body;
    const branding = await upsertBranding(pool, {
      userId: req.user.id, logoUrl: logo_url, primaryColor: primary_color,
      senderName: notification_sender_name, subdomain, actorId: req.user.id
    });
    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'branding', entityId: req.user.id,
      action: 'SET_BRANDING', after: branding, ip: req.ip
    });
    res.json({ message: 'Branding updated', branding });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 6F. GET/PUT /api/branding/:userId: Superadmin override — support/admin
//     path for setting a manufacturer's branding on their behalf. Target
//     must actually be a manufacturer; branding on any other role would
//     have no meaning (FR-WEB-036 attaches branding to the manufacturer
//     tier only, per §8.1).
// ----------------------------------------------------------------------------
app.get('/api/branding/:userId', authenticateToken, requireRole(['superadmin']), async (req, res) => {
  try {
    res.json({ branding: await getBranding(req.params.userId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/branding/:userId', authenticateToken, requireRole(['superadmin']), async (req, res) => {
  try {
    const targetRes = await pool.query(`SELECT role FROM agripump.users WHERE id = $1`, [req.params.userId]);
    if (targetRes.rows.length === 0) return res.status(404).json({ error: 'Account not found' });
    if (targetRes.rows[0].role !== 'manufacturer') {
      return res.status(400).json({ error: 'Branding only applies to manufacturer-tier accounts' });
    }

    const { logo_url, primary_color, notification_sender_name, subdomain } = req.body;
    const branding = await upsertBranding(pool, {
      userId: req.params.userId, logoUrl: logo_url, primaryColor: primary_color,
      senderName: notification_sender_name, subdomain, actorId: req.user.id
    });
    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'branding', entityId: req.params.userId,
      action: 'SET_BRANDING', after: branding, ip: req.ip
    });
    res.json({ message: 'Branding updated', branding });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 6C. GET /api/users/tree: Scoped hierarchy explorer (replaces the hard-coded
//     5-node HTML in the RBAC tab).
// ----------------------------------------------------------------------------
app.get('/api/users/tree', authenticateToken, async (req, res) => {
  try {
    const rootPath = req.user.role === 'superadmin' ? ROOT_HIERARCHY_PATH : req.user.hierarchy_path;
    const result = await pool.query(
      `SELECT id, full_name, phone_number, role, hierarchy_path, parent_user_id, dealer_depth, org_node_id, org_role, account_status
       FROM agripump.users WHERE hierarchy_path LIKE $1 || '%' ORDER BY hierarchy_path ASC`,
      [rootPath]
    );

    // P-1 — several logins can share one org unit's hierarchy_path
    // (Web_App_Pending_Items.md §8.1.2). The tree branches on org UNITS,
    // identified by org_node_id (or a user's own id, if they're the
    // owner); every login in a unit is listed under `members`, and only
    // the unit itself participates in parent_user_id branching — a staff
    // login never spawns its own branch.
    const byId = new Map(result.rows.map(u => [u.id, u]));
    const units = new Map();

    for (const u of result.rows) {
      const rootId = u.org_node_id || u.id;
      if (!units.has(rootId)) {
        const ownerRow = byId.get(rootId) || u;
        units.set(rootId, { ...ownerRow, members: [], children: [] });
      }
      units.get(rootId).members.push(u);
    }

    const roots = [];
    for (const unit of units.values()) {
      const parentUnitId = unit.parent_user_id ? (byId.get(unit.parent_user_id)?.org_node_id || unit.parent_user_id) : null;
      if (parentUnitId && parentUnitId !== unit.id && units.has(parentUnitId)) {
        units.get(parentUnitId).children.push(unit);
      } else {
        roots.push(unit);
      }
    }

    res.json({ scope_root: rootPath, tree: roots });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 6B2. PUT /api/users/:id: Edit an account — full_name, and (Superadmin
//      only) contract_notes, device_quota, account_status. FR-WEB-012
//      ("create, edit, suspend and delete panel-manufacturer
//      organisations, including contract details and device quotas") is
//      written as a Superadmin function; the mechanism (account_status)
//      is generic on `users` so it isn't hard-coded to one role.
// ----------------------------------------------------------------------------
app.put('/api/users/:id', authenticateToken, requireRole(['superadmin']), async (req, res) => {
  try {
    const { full_name, contract_notes, device_quota, account_status } = req.body;
    if (account_status && !['ACTIVE', 'SUSPENDED'].includes(account_status)) {
      return res.status(400).json({ error: 'account_status must be ACTIVE or SUSPENDED' });
    }

    const before = await pool.query(`SELECT id, full_name, contract_notes, device_quota, account_status FROM agripump.users WHERE id = $1`, [req.params.id]);
    if (before.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const result = await pool.query(
      `UPDATE agripump.users SET
         full_name = COALESCE($1, full_name),
         contract_notes = COALESCE($2, contract_notes),
         device_quota = COALESCE($3, device_quota),
         account_status = COALESCE($4, account_status)
       WHERE id = $5
       RETURNING id, full_name, role, contract_notes, device_quota, account_status`,
      [full_name || null, contract_notes ?? null, device_quota ?? null, account_status || null, req.params.id]
    );

    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'user', entityId: req.params.id,
      action: account_status ? `ACCOUNT_${account_status}` : 'UPDATE', before: before.rows[0], after: result.rows[0], ip: req.ip
    });

    res.json({ message: 'User updated', user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 6B3. DELETE /api/users/:id: Remove an account (Superadmin only). Refuses
//      rather than cascading if the account still owns pumps or has
//      subordinates/staff — those need reassigning first, not silently
//      orphaning or deleting a chain of dependent records.
// ----------------------------------------------------------------------------
app.delete('/api/users/:id', authenticateToken, requireRole(['superadmin']), async (req, res) => {
  try {
    const [pumpCount, childCount] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS n FROM agripump.pumps WHERE owner_user_id = $1`, [req.params.id]),
      pool.query(`SELECT COUNT(*) AS n FROM agripump.users WHERE parent_user_id = $1 OR org_node_id = $1`, [req.params.id])
    ]);
    if (Number(pumpCount.rows[0].n) > 0) {
      return res.status(409).json({ error: `Cannot delete: this account still owns ${pumpCount.rows[0].n} device(s). Reassign them first.` });
    }
    if (Number(childCount.rows[0].n) > 0) {
      return res.status(409).json({ error: `Cannot delete: this account still has ${childCount.rows[0].n} subordinate or staff account(s). Reassign or remove them first.` });
    }

    const result = await pool.query(`DELETE FROM agripump.users WHERE id = $1 RETURNING id, full_name`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    await writeAudit(pool, {
      actorId: req.user.id, actorRole: req.user.role, entityType: 'user', entityId: req.params.id,
      action: 'DELETE', before: result.rows[0], ip: req.ip
    });

    res.json({ message: `User ${result.rows[0].full_name} deleted`, deleted_id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 6C. GET /api/audit-log: Append-only audit trail (FR-CLD-062 / FR-WEB-016)
// ----------------------------------------------------------------------------
app.get(
  '/api/audit-log',
  authenticateToken,
  requireRole(['superadmin', 'manufacturer', 'distributor', 'dealer']),
  async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
    const entityType = req.query.entity_type || null;

    let queryText;
    let params;
    if (req.user.role === 'superadmin') {
      queryText = `SELECT al.* FROM agripump.audit_log al WHERE ($1::text IS NULL OR al.entity_type = $1) ORDER BY al.occurred_at DESC LIMIT $2`;
      params = [entityType, limit];
    } else {
      // Scoped: only entries whose actor sits within the caller's own sub-tree.
      queryText = `
        SELECT al.* FROM agripump.audit_log al
        LEFT JOIN agripump.users u ON u.id = al.actor_id
        WHERE (u.hierarchy_path LIKE $1 || '%') AND ($2::text IS NULL OR al.entity_type = $2)
        ORDER BY al.occurred_at DESC LIMIT $3`;
      params = [req.user.hierarchy_path || ROOT_HIERARCHY_PATH, entityType, limit];
    }

    const result = await pool.query(queryText, params);
    res.json({ count: result.rows.length, entries: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 7. POST /api/alerts/send: DLT SMS & WhatsApp Alert Trigger (Authenticated)
// ----------------------------------------------------------------------------
app.post('/api/alerts/send', authenticateToken, async (req, res) => {
  try {
    const { phone_number, template_key, vars, language, channel } = req.body;
    const phone = phone_number || req.user.phone_number;

    if (!phone) {
      return res.status(400).json({ error: 'Recipient phone number is required' });
    }

    const tKey = template_key || 'SINGLE_PHASING';
    const lang = language || 'hi';
    const targetChannel = channel || 'BOTH';

    let smsResult = null;
    let waResult = null;

    if (targetChannel === 'SMS' || targetChannel === 'BOTH') {
      smsResult = await sendDltSms(phone, tKey, vars || ['Borewell Pump #1'], lang);
    }
    if (targetChannel === 'WHATSAPP' || targetChannel === 'BOTH') {
      waResult = await sendWhatsAppAlert(phone, tKey, vars || ['Borewell Pump #1'], lang);
    }

    res.json({
      status: 'DISPATCHED',
      phone_number: phone,
      template_key: tKey,
      language: lang,
      sms: smsResult,
      whatsapp: waResult
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../web/index.html'));
});

const PORT = process.env.PORT || 5000;
const httpServer = app.listen(PORT, () => {
  console.log(`🚀 AgriPump Web App & REST API running on http://localhost:${PORT}`);
});
attachWebSocketServer(httpServer);
console.log(`🔌 WebSocket hub listening at ws://localhost:${PORT}/ws (FR-WEB-005)`);

// Offline-alert sweep (FR-WEB-060/062 alert engine) — nothing else
// transitions a pump to/from OFFLINE, see services/alertEngine.js.
setInterval(() => {
  runOfflineSweep(pool).catch(err => console.error('⚠️ Offline sweep failed:', err.message));
}, 60000).unref();
