/**
 * AgriPump SmartSpace - Minimal in-memory rate limiter (FR-CLD-043 / FR-SEC-024)
 *
 * Intentionally dependency-free (fixed-window counter, per-key). This is a
 * single-process limiter — fine for one backend instance; a multi-instance
 * deployment needs a shared store (Redis) instead, noted below rather than
 * silently pretending this scales.
 *
 * Not a replacement for FR-CLD-043's per-API-key rate limiting on the full
 * API surface — that needs the versioned API and API-key model that don't
 * exist yet. This closes the immediate gap on the auth endpoints, which are
 * the ones an attacker would actually hammer (OTP brute force, credential
 * stuffing).
 */

const buckets = new Map(); // key -> { count, windowStart }

function rateLimit({ windowMs, max, keyFn }) {
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    const entry = buckets.get(key);

    if (!entry || now - entry.windowStart >= windowMs) {
      buckets.set(key, { count: 1, windowStart: now });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      const retryAfterSec = Math.ceil((entry.windowStart + windowMs - now) / 1000);
      res.set('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        error: `Too many requests. Try again in ${retryAfterSec}s.`,
        retry_after_seconds: retryAfterSec
      });
    }
    next();
  };
}

// Periodic sweep so the map doesn't grow unbounded on a long-running process.
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, entry] of buckets) {
    if (entry.windowStart < cutoff) buckets.delete(key);
  }
}, 10 * 60 * 1000).unref();

function keyByIpAndBody(field) {
  return (req) => `${req.ip}:${(req.body && req.body[field]) || ''}`;
}

module.exports = { rateLimit, keyByIpAndBody };
