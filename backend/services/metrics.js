/**
 * In-memory process counters backing GET /api/system/health (FR-WEB-017).
 * Every number here is incremented at a real code path (an HTTP response
 * actually sent, a telemetry insert actually attempted, a notification
 * call actually made) — nothing is synthesized for display. Resets on
 * process restart: this is a live snapshot of the current process, not a
 * persisted historical record.
 */
const counters = {
  http_requests_total: 0,
  http_errors_4xx: 0,
  http_errors_5xx: 0,
  telemetry_ingest_success: 0,
  telemetry_ingest_failure: 0,
  sms_sent: 0,
  sms_failed: 0,
  whatsapp_sent: 0,
  whatsapp_failed: 0
};

function increment(key) {
  if (!(key in counters)) throw new Error(`Unknown metric key: ${key}`);
  counters[key]++;
}

function snapshot() {
  return { ...counters };
}

module.exports = { increment, snapshot };
