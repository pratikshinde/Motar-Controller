/**
 * AgriPump SmartSpace - Native HS256 JWT Signing & Verification Service
 * Uses Node.js built-in crypto module for zero external dependency overhead.
 *
 * v2 changes (FR-CLD-041 — SRS §10):
 *   - Access tokens now expire in 15 minutes, not 7 days.
 *   - A separate opaque, rotating refresh token is issued alongside the
 *     access token (see server.js /api/auth/refresh and /api/auth/logout).
 *     The refresh token itself is never stored — only its SHA-256 hash, in
 *     agripump.refresh_tokens — so a leaked database dump doesn't hand out
 *     usable tokens.
 *   - JWT_SECRET no longer silently falls back to a random value that dies
 *     with the process (which meant a server restart invalidated every
 *     session, and two instances behind a load balancer couldn't validate
 *     each other's tokens). It now falls back to a value generated once and
 *     persisted to backend/.jwt-secret (gitignored), so it's stable across
 *     restarts on a single machine. Set JWT_SECRET in the environment for
 *     any multi-instance or production deployment — that already works
 *     unchanged.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // FR-CLD-041: <= 15 min
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;

  const secretPath = path.join(__dirname, '..', '.jwt-secret');
  try {
    return fs.readFileSync(secretPath, 'utf8').trim();
  } catch (err) {
    const generated = crypto.randomBytes(32).toString('hex');
    try {
      fs.writeFileSync(secretPath, generated, { mode: 0o600 });
      console.warn(
        `⚠️  JWT_SECRET not set in environment — generated one and saved it to ${secretPath} ` +
        `(gitignored). Set JWT_SECRET explicitly before deploying more than one server instance.`
      );
    } catch (writeErr) {
      console.warn(
        `⚠️  JWT_SECRET not set and could not persist a generated one (${writeErr.message}). ` +
        `Using an in-memory secret — every session will be invalidated on restart. Set JWT_SECRET.`
      );
    }
    return generated;
  }
}

const JWT_SECRET = resolveJwtSecret();

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Sign a new short-lived JWT access token.
 */
function signToken(payload, expiresInSeconds = ACCESS_TOKEN_TTL_SECONDS) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const expPayload = {
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(expPayload));
  const data = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${data}.${signature}`;
}

/**
 * Verify JWT token signature and expiration.
 */
function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;
  const data = `${encodedHeader}.${encodedPayload}`;

  const expectedSignature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  // Constant-time compare to avoid a timing side-channel on the signature check.
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired token
    }
    return payload;
  } catch (err) {
    return null;
  }
}

/**
 * Generate a new opaque refresh token (raw value to hand to the client) plus
 * its SHA-256 hash (the only thing that should ever be persisted).
 */
function generateRefreshToken() {
  const raw = crypto.randomBytes(48).toString('base64url');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash, expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000) };
}

function hashRefreshToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

module.exports = {
  signToken,
  verifyToken,
  generateRefreshToken,
  hashRefreshToken,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS
};
