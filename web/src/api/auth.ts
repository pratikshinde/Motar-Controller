import { apiFetch, apiJson, persistTokens, clearSession, getRefreshToken, getAuthToken, messageFrom, toAuthResult } from './client';
import type { LoginOutcome } from '../types';

/** Turns the API's login body into what the portal works with, storing the session unless a second step is needed. */
function outcomeFrom(body: any): LoginOutcome {
  if (body.mfa_required || body.requires_mfa || body.status === 'MFA_REQUIRED') {
    return {
      mfa_required: true,
      mfa_token: body.temp_token || body.challenge_id || '',
      expiresIn: 300
    };
  }
  const result = toAuthResult(body);
  persistTokens(result);
  return result;
}

function cleanPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return raw.trim().replace(/\s+/g, '');
}

export async function sendSmsOtp(phoneNumber: string) {
  const phone = cleanPhone(phoneNumber);
  const res = await apiFetch('/auth/send-otp', {
    method: 'POST',
    body: JSON.stringify({ phone_number: phone, phone })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(messageFrom(body, 'OTP request failed'));
  return body as { message: string; phone_number: string; dev_otp?: string };
}

export async function verifyOtp(phoneNumber: string, otpCode: string): Promise<LoginOutcome> {
  const phone = cleanPhone(phoneNumber);
  const res = await apiFetch('/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ phone_number: phone, phone, otp_code: otpCode, otp: otpCode })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(messageFrom(body, 'Authentication failed'));
  return outcomeFrom(body);
}

export async function loginWithPassword(phoneNumber: string, password: string): Promise<LoginOutcome> {
  const phone = cleanPhone(phoneNumber);
  const res = await apiFetch('/auth/login-password', {
    method: 'POST',
    body: JSON.stringify({ phone_number: phone, password })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(messageFrom(body, 'Authentication failed'));
  return outcomeFrom(body);
}

/** A distributor's or dealer's first sign-in (and how a lost password is replaced): the QR link, the registered mobile number and a new password. */
export async function claimPartnerAccount(token: string, phoneNumber: string, password: string): Promise<LoginOutcome> {
  const res = await apiFetch('/auth/partner-claim', {
    method: 'POST',
    body: JSON.stringify({ qr: `AGP-CLAIM:${token}`, phone: cleanPhone(phoneNumber), password })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(messageFrom(body, 'Could not open this link'));
  return outcomeFrom(body);
}

/** Step 1 of the admin's and the platform owner's sign-in: a 6-digit code is emailed to the address (if it belongs to one of them; the answer never says which). */
export async function requestEmailCode(email: string): Promise<void> {
  const res = await apiFetch('/auth/email-code/request', { method: 'POST', body: JSON.stringify({ email: email.trim() }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(messageFrom(body, 'Could not send the code. Try again in a moment.'));
}

/** Step 2: the emailed code. The platform owner gets the authenticator challenge back (isMfaRequired); an admin is signed in. */
export async function loginWithEmailCode(email: string, code: string): Promise<LoginOutcome> {
  const res = await apiFetch('/auth/email-code/verify', { method: 'POST', body: JSON.stringify({ email: email.trim(), code: code.trim() }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(messageFrom(body, 'That code is not right, or it has expired. Ask for a new one.'));
  return outcomeFrom(body);
}

export async function loginWithEmail(email: string, password: string): Promise<LoginOutcome> {
  const res = await apiFetch('/auth/login-email', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim(), password })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(messageFrom(body, 'Sign-in failed'));
  return outcomeFrom(body);
}

export async function logout() {
  try {
    if (getAuthToken()) {
      await apiFetch('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: getRefreshToken() })
      });
    }
  } catch {
    // Best-effort server-side revocation; local session is cleared regardless.
  }
  clearSession();
}

export { apiJson };
