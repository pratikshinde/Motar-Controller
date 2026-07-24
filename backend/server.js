const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { sendDltSms, sendWhatsAppAlert, DLT_TEMPLATES } = require('./services/notificationService');
const { signToken } = require('./services/jwtAuth');
const { authenticateToken, requireRole } = require('./middleware/authMiddleware');

const app = express();

// CORS configuration - allow localhost in dev or explicit origins in production
const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS 
  ? process.env.CORS_ALLOWED_ORIGINS.split(',') 
  : ['http://localhost:5000', 'http://127.0.0.1:5000'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('CORS Policy Error: Origin not allowed'));
    }
  },
  credentials: true
}));

app.use(express.json());

// Serve static frontend files from web/ folder
app.use(express.static(path.join(__dirname, '../web')));

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || 'propcb',
  password: process.env.PGPASSWORD || 'propcb_dev_password',
  database: process.env.PGDATABASE || 'propcb',
});

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

// ----------------------------------------------------------------------------
// ROOT HEALTH CHECK & API SITEMAP
// ----------------------------------------------------------------------------
app.get('/api', (req, res) => {
  res.json({
    status: 'ONLINE',
    system: 'AgriPump SmartSpace IoT REST API',
    database: 'PostgreSQL propcb (schema: agripump)',
    endpoints: {
      authLogin: 'POST /api/auth/login',
      getPumps: 'GET /api/pumps?hierarchy_path=...&page=1&limit=50&search=...',
      createPump: 'POST /api/pumps (Superadmin Only)',
      updateLocation: 'POST /api/pumps/:id/location (Superadmin Only)',
      deletePump: 'DELETE /api/pumps/:id (Superadmin Only)',
      ingestTelemetry: 'POST /api/telemetry',
      createSubordinateUser: 'POST /api/users',
      sendAlerts: 'POST /api/alerts/send (Authenticated)'
    }
  });
});

// ----------------------------------------------------------------------------
// 0. POST /api/auth/login: JWT Authentication Login Endpoint
// ----------------------------------------------------------------------------
app.post('/api/auth/login', async (req, res) => {
  try {
    const { phone_number, role } = req.body;
    if (!phone_number) {
      return res.status(400).json({ error: 'Mobile phone number is required' });
    }

    const cleanPhone = phone_number.replace(/\s+/g, '');
    const userRole = role || 'customer';

    // Look up existing user or construct default authenticated session
    let userRecord = {
      id: '11111111-1111-1111-1111-111111111111',
      full_name: userRole === 'superadmin' ? 'Superadmin Platform' : (userRole === 'customer' ? 'Ramesh Patel (Farmer)' : `${userRole.toUpperCase()} Account`),
      phone_number: cleanPhone,
      role: userRole,
      hierarchy_path: '11111111-1111-1111-1111-111111111111'
    };

    try {
      const dbUserRes = await pool.query(
        `SELECT id, full_name, phone_number, role, hierarchy_path FROM agripump.users WHERE phone_number = $1 OR role = $2 LIMIT 1`,
        [cleanPhone, userRole]
      );
      if (dbUserRes.rows.length > 0) {
        userRecord = dbUserRes.rows[0];
      }
    } catch (dbErr) {
      console.warn('DB lookup warning during auth:', dbErr.message);
    }

    const token = signToken({
      id: userRecord.id,
      phone_number: userRecord.phone_number,
      role: userRecord.role,
      hierarchy_path: userRecord.hierarchy_path
    });

    res.json({
      message: 'Authentication successful',
      token,
      user: userRecord
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 1. GET /api/pumps: Scalable Authenticated Fetch for Fleet Devices
// ----------------------------------------------------------------------------
app.get('/api/pumps', authenticateToken, async (req, res) => {
  try {
    const userHierarchyPath = req.user.hierarchy_path || '11111111-1111-1111-1111-111111111111';
    const parentPath = req.query.hierarchy_path || userHierarchyPath;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${req.query.search}%` : null;

    let queryText = `
      SELECT id, name, supply_type, hp_rating, latitude, longitude, status, firmware_version, last_seen_at
      FROM agripump.pumps 
      WHERE hierarchy_path LIKE $1 || '%'
    `;
    let queryParams = [parentPath];

    if (search) {
      queryParams.push(search);
      queryText += ` AND (name ILIKE $${queryParams.length} OR id ILIKE $${queryParams.length})`;
    }

    queryText += ` ORDER BY name ASC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
    queryParams.push(limit, offset);

    const result = await pool.query(queryText, queryParams);

    const statsRes = await pool.query(
      `SELECT 
         COUNT(*) as total_devices,
         COUNT(*) FILTER (WHERE status = 'RUNNING') as running_count,
         COUNT(*) FILTER (WHERE status = 'FAULT') as fault_count,
         COUNT(*) FILTER (WHERE status = 'STOPPED') as stopped_count
       FROM agripump.pumps
       WHERE hierarchy_path LIKE $1 || '%'`,
      [parentPath]
    );

    res.json({
      meta: {
        page,
        limit,
        stats: statsRes.rows[0]
      },
      pumps: result.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    const hPath = hierarchy_path || req.user.hierarchy_path || '11111111-1111-1111-1111-111111111111';

    const result = await pool.query(
      `INSERT INTO agripump.pumps (id, name, supply_type, hp_rating, latitude, longitude, status, hierarchy_path, firmware_version)
       VALUES ($1, $2, $3, $4, $5, $6, 'STOPPED', $7, 'v2.4.1')
       ON CONFLICT (id) DO UPDATE SET 
         name = EXCLUDED.name,
         supply_type = EXCLUDED.supply_type,
         hp_rating = EXCLUDED.hp_rating,
         latitude = EXCLUDED.latitude,
         longitude = EXCLUDED.longitude
       RETURNING id, name, supply_type, hp_rating, latitude, longitude, status, hierarchy_path, firmware_version`,
      [pumpId, pumpName, sType, hp, lat, lng, hPath]
    );

    res.status(201).json({ message: 'Pump device registered successfully', pump: result.rows[0] });
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

    const result = await pool.query(
      `UPDATE agripump.pumps 
       SET latitude = $1, 
           longitude = $2, 
           last_seen_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING id, name, latitude, longitude`,
      [latitude, longitude, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pump device not found' });
    }

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

    res.json({ message: `Pump ${id} deleted successfully`, deleted_id: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 5. POST /api/telemetry: Ingest 4G Cellular Telemetry Packet
// ----------------------------------------------------------------------------
app.post('/api/telemetry', async (req, res) => {
  try {
    const { pump_id, v_ry, v_yb, v_br, i_r, i_y, i_b, pump_on, fault_active } = req.body;

    if (!pump_id) {
      return res.status(400).json({ error: 'pump_id is required' });
    }

    await pool.query(
      `INSERT INTO agripump.telemetry_history (pump_id, v_ry, v_yb, v_br, i_r, i_y, i_b, pump_on, fault_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [pump_id, v_ry, v_yb, v_br, i_r, i_y, i_b, pump_on, fault_active]
    );

    const status = fault_active ? 'FAULT' : (pump_on ? 'RUNNING' : 'STOPPED');
    await pool.query(
      `UPDATE agripump.pumps SET status = $1, last_seen_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [status, pump_id]
    );

    res.json({ status: 'SUCCESS', pump_id, status_updated: status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------------------
// 6. POST /api/users: Create Subordinate User Account (9-Tier RBAC)
// ----------------------------------------------------------------------------
app.post('/api/users', authenticateToken, requireRole(['superadmin', 'manufacturer', 'distributor', 'dealer1', 'dealer5']), async (req, res) => {
  try {
    const { full_name, phone_number, role, parent_user_id, parent_hierarchy_path, preferred_language } = req.body;

    if (!full_name || !phone_number || !role) {
      return res.status(400).json({ error: 'full_name, phone_number, and role are required' });
    }

    const userRes = await pool.query(`SELECT public.uuid_generate_v4() as new_id`);
    const newId = userRes.rows[0].new_id;
    const parentPath = parent_hierarchy_path || req.user.hierarchy_path || '11111111-1111-1111-1111-111111111111';
    const newPath = `${parentPath}/${newId}`;

    const result = await pool.query(
      `INSERT INTO agripump.users (id, full_name, phone_number, role, hierarchy_path, parent_user_id, preferred_language)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, full_name, role, hierarchy_path`,
      [newId, full_name.trim(), phone_number.trim(), role, newPath, parent_user_id || req.user.id, preferred_language || 'en']
    );

    res.status(201).json({ message: 'Subordinate user created', user: result.rows[0] });
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
app.listen(PORT, () => {
  console.log(`🚀 AgriPump Web App & REST API running on http://localhost:${PORT}`);
});
