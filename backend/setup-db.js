const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

async function initDatabase() {
  const host = process.env.PGHOST || 'localhost';
  const port = process.env.PGPORT || 5432;
  const user = process.env.PGUSER || 'propcb';
  const password = process.env.PGPASSWORD || 'propcb_dev_password';
  const database = process.env.PGDATABASE || 'propcb';
  const schema = process.env.PGSCHEMA || 'agripump';

  console.log(`🔄 Connecting to local PostgreSQL at ${host}:${port}/${database} as user '${user}'...`);

  const pool = new Pool({
    host,
    port,
    user,
    password,
    database,
  });

  try {
    console.log(`📄 Creating schema '${schema}' & applying PostGIS tables and seed data...`);
    const sqlPath = path.join(__dirname, 'schema.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    await pool.query(sqlContent);
    console.log(`🎉 SUCCESS! Schema '${schema}' and PostGIS tables created inside database '${database}'!`);
  } catch (err) {
    console.error(`❌ Schema Application Error:`, err.message);
  } finally {
    await pool.end();
  }
}

initDatabase();
