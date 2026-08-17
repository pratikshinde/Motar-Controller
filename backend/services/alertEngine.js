/**
 * Alert engine — FR-WEB-060/062/063, scoped down per product-owner
 * direction (17 Aug 2026): the only delivery channel is in-app over the
 * WebSocket hub while a user is connected. SMS/WhatsApp/email
 * (FR-WEB-061's other channels, FR-WEB-064's templates) are a later paid
 * add-on and are not wired in here — services/notificationService.js
 * already has working senders for when that lands.
 *
 * Two alert types today: FAULT (from fault_logs) and OFFLINE (from the
 * sweep below — nothing else transitions a pump to offline). Dedup is a
 * time-bucket (see schema.sql §16 comment), not a sliding window.
 */
const { sendToUsers } = require('./wsHub');

const DEDUP_WINDOW_SECONDS = 900; // 15 min, SRS §8.5 FR-WEB-062 default
const OFFLINE_THRESHOLD_MS = 15 * 60 * 1000; // matches the connectivity threshold used elsewhere in server.js
const DIGEST_WINDOW_MS = 5000;

const SEVERITY_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

function dedupBucket(date = new Date()) {
  return Math.floor(date.getTime() / 1000 / DEDUP_WINDOW_SECONDS);
}

/**
 * Insert-or-bump an alert. Returns { alert, isNewOccurrence } — callers
 * should only notify subscribers when isNewOccurrence is true, or a
 * repeating fault would re-notify on every single occurrence instead of
 * being deduplicated.
 */
async function raiseAlert(pool, { pumpId, alertType, severity, faultCode = null, sourceFaultLogId = null }) {
  const bucket = dedupBucket();
  const result = await pool.query(
    `INSERT INTO agripump.alerts (pump_id, alert_type, severity, fault_code, source_fault_log_id, dedup_bucket)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (pump_id, alert_type, COALESCE(fault_code, -1), dedup_bucket)
     DO UPDATE SET
       occurrence_count = agripump.alerts.occurrence_count + 1,
       last_occurred_at = CURRENT_TIMESTAMP,
       source_fault_log_id = EXCLUDED.source_fault_log_id
     RETURNING *, (xmax = 0) AS is_new_occurrence`,
    [pumpId, alertType, severity, faultCode, sourceFaultLogId, bucket]
  );
  const row = result.rows[0];
  const { is_new_occurrence, ...alert } = row;
  return { alert, isNewOccurrence: is_new_occurrence };
}

async function resolveOfflineAlert(pool, pumpId) {
  await pool.query(
    `UPDATE agripump.alerts SET resolved_at = CURRENT_TIMESTAMP
     WHERE pump_id = $1 AND alert_type = 'OFFLINE' AND resolved_at IS NULL`,
    [pumpId]
  );
}

/**
 * Periodic job (server.js wires this via setInterval, same convention as
 * simulator/deviceSimulator.js and this file's own digest flush below —
 * no queue/cron infra in this codebase). Nothing today transitions a pump
 * to OFFLINE; this is that transition, both directions.
 */
async function runOfflineSweep(pool) {
  const goneDark = await pool.query(
    `SELECT p.id, p.hierarchy_path FROM agripump.pumps p
     WHERE p.last_seen_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes'
       AND NOT EXISTS (
         SELECT 1 FROM agripump.alerts a
         WHERE a.pump_id = p.id AND a.alert_type = 'OFFLINE' AND a.resolved_at IS NULL
       )`
  );
  for (const pump of goneDark.rows) {
    const { alert, isNewOccurrence } = await raiseAlert(pool, { pumpId: pump.id, alertType: 'OFFLINE', severity: 'HIGH' });
    if (isNewOccurrence) await deliverAlert(pool, alert);
  }

  const backOnline = await pool.query(
    `SELECT DISTINCT a.pump_id FROM agripump.alerts a
     JOIN agripump.pumps p ON p.id = a.pump_id
     WHERE a.alert_type = 'OFFLINE' AND a.resolved_at IS NULL
       AND p.last_seen_at >= CURRENT_TIMESTAMP - INTERVAL '15 minutes'`
  );
  for (const row of backOnline.rows) {
    await resolveOfflineAlert(pool, row.pump_id);
  }
}

// Per-recipient coalescing buffer for the FR-WEB-062 storm digest — a
// burst of alerts landing for the same user within DIGEST_WINDOW_MS is
// sent as one alert_digest message instead of N separate alert messages.
// In-memory, single-process, same "no Redis" caveat middleware/rateLimiter.js
// already documents for its own Map.
const pendingByUser = new Map(); // userId -> { timer, alerts: [] }

function flushDigest(userId) {
  const pending = pendingByUser.get(userId);
  if (!pending) return;
  pendingByUser.delete(userId);
  if (pending.alerts.length === 1) {
    sendToUsers([userId], { type: 'alert', alert: pending.alerts[0] });
  } else {
    sendToUsers([userId], { type: 'alert_digest', alerts: pending.alerts });
  }
}

function queueForDelivery(userId, alert) {
  let pending = pendingByUser.get(userId);
  if (!pending) {
    pending = { timer: setTimeout(() => flushDigest(userId), DIGEST_WINDOW_MS).unref(), alerts: [] };
    pendingByUser.set(userId, pending);
  }
  pending.alerts.push(alert);
}

/**
 * Resolves eligible subscribers for one alert and queues delivery to
 * whichever of them are currently WebSocket-connected. Default (no
 * subscription rows) = subscribed to everything in the caller's own
 * hierarchy scope, per the schema.sql §16 comment — narrower rows can
 * mute or restrict by pump/type/severity.
 */
async function deliverAlert(pool, rawAlert) {
  const pumpRes = await pool.query(`SELECT name, hierarchy_path FROM agripump.pumps WHERE id = $1`, [rawAlert.pump_id]);
  const pump = pumpRes.rows[0];
  if (!pump) return;
  const hierarchyPath = pump.hierarchy_path;

  // Enrich with the same human-readable fields GET /api/alerts already
  // joins in, so a live WS-delivered alert and one fetched from the list
  // later render identically — not a bare fault_code int.
  let faultName = null;
  if (rawAlert.fault_code !== null && rawAlert.fault_code !== undefined) {
    const catalog = await pool.query(`SELECT name FROM agripump.fault_code_catalog WHERE code = $1`, [rawAlert.fault_code]);
    faultName = catalog.rows[0]?.name || null;
  }
  const alert = { ...rawAlert, pump_name: pump.name, fault_name: faultName };

  const usersRes = await pool.query(
    `SELECT u.id,
            s.id AS sub_id, s.pump_id AS sub_pump_id, s.alert_type AS sub_alert_type,
            s.min_severity AS sub_min_severity, s.muted AS sub_muted
     FROM agripump.users u
     LEFT JOIN agripump.alert_subscriptions s ON s.user_id = u.id
     WHERE u.role = 'superadmin' OR $1 LIKE u.hierarchy_path || '%'`,
    [hierarchyPath]
  );

  const byUser = new Map();
  for (const row of usersRes.rows) {
    if (!byUser.has(row.id)) byUser.set(row.id, []);
    if (row.sub_id !== null) {
      byUser.get(row.id).push({
        pumpId: row.sub_pump_id,
        alertType: row.sub_alert_type,
        minSeverity: row.sub_min_severity,
        muted: row.sub_muted
      });
    }
  }

  for (const [userId, subs] of byUser) {
    if (isEligible(alert, subs)) queueForDelivery(userId, alert);
  }
}

function isEligible(alert, subs) {
  if (subs.length === 0) return true; // no rows at all = default-subscribed to everything in scope

  const relevant = subs.filter(
    s => (s.pumpId === null || s.pumpId === alert.pump_id) && (s.alertType === null || s.alertType === alert.alert_type)
  );
  if (relevant.length === 0) return true; // rows exist but none narrow this pump/type — falls back to default

  if (relevant.some(s => s.muted)) return false;
  return relevant.some(s => !s.minSeverity || SEVERITY_RANK[alert.severity] >= SEVERITY_RANK[s.minSeverity]);
}

module.exports = { raiseAlert, resolveOfflineAlert, runOfflineSweep, deliverAlert, DEDUP_WINDOW_SECONDS, OFFLINE_THRESHOLD_MS };
