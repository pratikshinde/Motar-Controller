const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
require('dotenv').config();
const { hashSecret } = require('./services/secretHash');

function randomSecret(bytes = 12) {
  return crypto.randomBytes(bytes).toString('base64url');
}

async function initDatabase() {
  const host = process.env.PGHOST || 'localhost';
  const port = process.env.PGPORT || 5432;
  const user = process.env.PGUSER || 'propcb';
  const password = process.env.PGPASSWORD || 'propcb_dev_password';
  const database = process.env.PGDATABASE || 'propcb';
  const schema = process.env.PGSCHEMA || 'agripump';

  console.log(`🔄 Connecting to local PostgreSQL at ${host}:${port}/${database} as user '${user}'...`);

  const pool = new Pool({ host, port, user, password, database });

  try {
    console.log(`📄 Creating schema '${schema}' & applying tables and seed data...`);
    const sqlPath = path.join(__dirname, 'schema.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sqlContent);
    console.log(`🎉 SUCCESS! Schema '${schema}' created/updated inside database '${database}'.`);

    // ------------------------------------------------------------------
    // Generate a fresh random superadmin password + per-device telemetry
    // keys on every run where they are missing, instead of shipping a
    // known password/hash in schema.sql (SEC-2). Printed once, here only —
    // never written to a file or committed anywhere.
    // ------------------------------------------------------------------
    const superadmin = await pool.query(
      `SELECT id, phone_number, password_hash FROM agripump.users WHERE role = 'superadmin' ORDER BY created_at ASC LIMIT 1`
    );
    if (superadmin.rows.length > 0 && !superadmin.rows[0].password_hash) {
      const plainPassword = randomSecret(9);
      const hash = hashSecret(plainPassword);
      await pool.query(`UPDATE agripump.users SET password_hash = $1 WHERE id = $2`, [hash, superadmin.rows[0].id]);
      console.log('\n============================================================');
      console.log('🔐 SUPERADMIN PASSWORD GENERATED (shown once — save it now):');
      console.log(`   phone:    ${superadmin.rows[0].phone_number}`);
      console.log(`   password: ${plainPassword}`);
      console.log('   This is NOT stored anywhere in plaintext. Re-run with');
      console.log('   password_hash cleared in the DB to regenerate.');
      console.log('============================================================\n');
    }

    const pumpsNeedingKeys = await pool.query(
      `SELECT id FROM agripump.pumps WHERE device_key_hash IS NULL`
    );
    if (pumpsNeedingKeys.rows.length > 0) {
      console.log('🔑 DEVICE TELEMETRY KEYS GENERATED (shown once — needed by the simulator / real device config):');
      for (const row of pumpsNeedingKeys.rows) {
        const plainKey = randomSecret(16);
        const hash = hashSecret(plainKey);
        await pool.query(`UPDATE agripump.pumps SET device_key_hash = $1 WHERE id = $2`, [hash, row.id]);
        console.log(`   ${row.id}: ${plainKey}`);
      }
      console.log('   Set these as DEVICE_KEY in the simulator config or the real device provisioning record.\n');
    }
  } catch (err) {
    console.error(`❌ Schema Application Error:`, err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

initDatabase();
