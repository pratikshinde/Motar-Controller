/**
 * AgriPump SmartSpace - Shared salted-secret hashing (scryptSync).
 * Format: "salt_hex:hash_hex". Used for user passwords AND per-device
 * telemetry ingestion keys (SEC-1), so there's one implementation instead
 * of the hand-rolled copy that used to live only in server.js.
 */
const crypto = require('crypto');

function hashSecret(secret, customSalt = null) {
  const salt = customSalt || crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(secret, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

function verifySecret(inputSecret, storedSaltHash) {
  if (!storedSaltHash || !inputSecret) return false;

  // Legacy fallback for pre-v2 unsalted SHA-256 password hashes, if any
  // exist in a database that predates this change.
  if (!storedSaltHash.includes(':')) {
    const legacyHash = crypto.createHash('sha256').update(inputSecret).digest('hex');
    return legacyHash === storedSaltHash;
  }

  const [salt, originalHash] = storedSaltHash.split(':');
  const computedHash = crypto.scryptSync(inputSecret, salt, 64).toString('hex');
  const a = Buffer.from(originalHash, 'hex');
  const b = Buffer.from(computedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { hashSecret, verifySecret };
