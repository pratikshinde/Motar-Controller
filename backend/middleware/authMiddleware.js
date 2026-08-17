/**
 * AgriPump SmartSpace - JWT Authentication & RBAC Authorization Middleware
 */
const { verifyToken } = require('../services/jwtAuth');
const { verifySecret } = require('../services/secretHash');

/**
 * Verifies Bearer Token in Authorization header.
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ error: 'Access denied: Missing or malformed Bearer Token in Authorization header' });
  }

  const user = verifyToken(token);
  if (!user) {
    return res.status(403).json({ error: 'Access denied: Invalid or expired authentication token. Please sign in again.' });
  }

  // MFA-pending tokens (POST /api/auth/verify-otp or /login-password, when
  // the account has TOTP enabled) are signed with the same secret as a
  // real access token so they'd otherwise pass the check above too. They
  // carry no privilege — only POST /api/auth/mfa/verify may consume one.
  if (user.mfaPending) {
    return res.status(403).json({ error: 'Access denied: MFA verification not yet completed for this session.' });
  }

  req.user = user;
  next();
}

/**
 * Enforces role-based authorization check against token payload role.
 */
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Permission Denied: Account role '${req.user ? req.user.role : 'unauthenticated'}' is not authorized to perform this operation. Required role: [${allowedRoles.join(', ')}]`
      });
    }
    next();
  };
}

/**
 * Device authentication (SEC-1 fix — closes the previously-open
 * POST /api/telemetry endpoint). Devices authenticate with a per-device
 * shared key sent as `X-Device-Key`, checked against
 * pumps.device_key_hash for the pump_id / :id in the request.
 *
 * This is an interim HTTP-ingestion control, not the SRS §6.7 end state
 * (per-device X.509 client cert over AWS IoT mutual TLS, delivered by the
 * bridge in Stream 3). It closes the "anyone can post as any pump_id"
 * hole today, on the transport this backend actually has.
 *
 * `pumpIdParam` is a function (req) => pumpId, since the id arrives as a
 * body field on the ingest endpoint but a route param on device-facing
 * command endpoints.
 */
function authenticateDevice(pumpIdParam) {
  return async (req, res, next) => {
    const pool = req.app.get('pgPool');
    const deviceKey = req.headers['x-device-key'];
    const pumpId = pumpIdParam(req);

    if (!pumpId) {
      return res.status(400).json({ error: 'pump_id is required' });
    }
    if (!deviceKey) {
      return res.status(401).json({ error: 'Access denied: Missing X-Device-Key header' });
    }

    try {
      const result = await pool.query(
        `SELECT id, device_key_hash FROM agripump.pumps WHERE id = $1`,
        [pumpId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: `Unknown device: ${pumpId}` });
      }
      const pump = result.rows[0];
      if (!pump.device_key_hash || !verifySecret(deviceKey, pump.device_key_hash)) {
        return res.status(401).json({ error: 'Access denied: Invalid device key for this pump_id' });
      }
      req.pumpId = pumpId;
      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

module.exports = { authenticateToken, requireRole, authenticateDevice };
