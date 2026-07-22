const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
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
      getPumps: 'GET /api/pumps?hierarchy_path=...&page=1&limit=50&search=...',
      updateLocation: 'POST /api/pumps/:id/location',
      ingestTelemetry: 'POST /api/telemetry',
      createSubordinateUser: 'POST /api/users'
    }
  });
});

// ----------------------------------------------------------------------------
// 1. GET /api/pumps: Scalable Paginated Fetch for 1,000s of Devices
// ----------------------------------------------------------------------------
app.get('/api/pumps', async (req, res) => {
  try {
    const parentPath = req.query.hierarchy_path || '11111111-1111-1111-1111-111111111111';
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 500); // Cap max limit per query
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

    // Fleet Summary Aggregate Counters for Admin Dashboard
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
// 2. POST /api/pumps/:id/location: Save GPS Location
// ----------------------------------------------------------------------------
app.post('/api/pumps/:id/location', async (req, res) => {
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
// 3. POST /api/telemetry: Ingest 4G Cellular Telemetry Packet
// ----------------------------------------------------------------------------
app.post('/api/telemetry', async (req, res) => {
  try {
    const { pump_id, v_ry, v_yb, v_br, i_r, i_y, i_b, pump_on, fault_active } = req.body;

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
// 4. POST /api/users: Create Subordinate User Account (9-Tier RBAC)
// ----------------------------------------------------------------------------
app.post('/api/users', async (req, res) => {
  try {
    const { full_name, phone_number, role, parent_user_id, parent_hierarchy_path, preferred_language } = req.body;

    const userRes = await pool.query(`SELECT public.uuid_generate_v4() as new_id`);
    const newId = userRes.rows[0].new_id;
    const newPath = `${parent_hierarchy_path}/${newId}`;

    const result = await pool.query(
      `INSERT INTO agripump.users (id, full_name, phone_number, role, hierarchy_path, parent_user_id, preferred_language)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, full_name, role, hierarchy_path`,
      [newId, full_name, phone_number, role, newPath, parent_user_id, preferred_language || 'en']
    );

    res.status(201).json({ message: 'Subordinate user created', user: result.rows[0] });
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
