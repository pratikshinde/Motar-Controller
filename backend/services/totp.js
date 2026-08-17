/**
 * TOTP (RFC 6238) over HOTP (RFC 4226) — FR-WEB-001, mandatory MFA for
 * superadmin and manufacturer-role accounts. Web_App_Pending_Items.md W3.
 *
 * Hand-rolled with Node's built-in `crypto`, in the same spirit as
 * services/jwtAuth.js ("zero external dependency overhead"). Unlike HMAC
 * signing, TOTP genuinely is simple enough to implement correctly from
 * the spec — HOTP is one paragraph of dynamic truncation over an
 * HMAC-SHA1 digest — and RFC 4226 Appendix D publishes exact test
 * vectors, so correctness here isn't a matter of trust, it's checked
 * automatically against them below every time this module loads. If that
 * check ever fails, the module refuses to load rather than silently
 * accepting/rejecting the wrong codes.
 */
const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** RFC 4226 §5.3 — HMAC-SHA1, then dynamic truncation to `digits` decimal digits. */
function hotp(secretBuffer, counter, digits = 6) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBuffer).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return (binCode % 10 ** digits).toString().padStart(digits, '0');
}

/** RFC 6238 — HOTP with counter = floor(unixTime / step). */
function totp(secretBuffer, { step = 30, digits = 6, forTime = Date.now() } = {}) {
  const counter = Math.floor(forTime / 1000 / step);
  return hotp(secretBuffer, counter, digits);
}

/**
 * `window: 1` accepts the previous and next 30s step alongside the
 * current one, to absorb ordinary clock drift between server and phone
 * without accepting a code more than ~30s stale in either direction.
 */
function verifyTotp(base32Secret, token, { step = 30, digits = 6, window = 1, forTime = Date.now() } = {}) {
  if (!token || !new RegExp(`^\\d{${digits}}$`).test(String(token).trim())) return false;
  const secretBuffer = base32Decode(base32Secret);
  const counter = Math.floor(forTime / 1000 / step);
  for (let delta = -window; delta <= window; delta++) {
    if (hotp(secretBuffer, counter + delta, digits) === String(token).trim()) return true;
  }
  return false;
}

function generateSecret(byteLength = 20) {
  return base32Encode(crypto.randomBytes(byteLength));
}

function buildOtpauthUrl({ secret, accountName, issuer }) {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// Self-test against RFC 4226 Appendix D on module load (ASCII secret
// "12345678901234567890", 8-byte counters 0-9). A real cryptographic
// primitive should prove itself correct before anything trusts it.
(function selfTest() {
  const vectors = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  const secret = Buffer.from('12345678901234567890', 'ascii');
  for (let i = 0; i < vectors.length; i++) {
    const got = hotp(secret, i, 6);
    if (got !== vectors[i]) {
      throw new Error(`TOTP self-test failed at counter ${i}: expected ${vectors[i]}, got ${got}. Refusing to load — MFA codes would be wrong.`);
    }
  }
})();

module.exports = { hotp, totp, verifyTotp, generateSecret, base32Encode, base32Decode, buildOtpauthUrl };
