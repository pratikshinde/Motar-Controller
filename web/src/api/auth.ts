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
