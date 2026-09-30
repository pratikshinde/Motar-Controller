import { apiFetch, apiJson, persistTokens, clearSession, getRefreshToken, getAuthToken, messageFrom, toAuthResult } from './client';
import type { LoginOutcome } from '../types';

/** Turns the API's login body into what the portal works with, storing the session unless a second step is needed. */
function outcomeFrom(body: any): LoginOutcome {
  if (body.mfa_required) return { mfa_required: true, mfa_token: body.temp_token, expiresIn: 300 };
  const result = toAuthResult(body);
  persistTokens(result);
  return result;
}

export async function sendSmsOtp(phoneNumber: string) {
  const res = await apiFetch('/auth/send-otp', {
    method: 'POST',
    body: JSON.stringify({ phone_number: phoneNumber })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(messageFrom(body, 'OTP request failed'));
  return body as { message: string; phone_number: string; dev_otp?: string };
}

export async function verifyOtp(phoneNumber: string, otpCode: string): Promise<LoginOutcome> {
  const res = await apiFetch('/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ phone_number: phoneNumber, otp_code: otpCode })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(messageFrom(body, 'Authentication failed'));
  return outcomeFrom(body);
}

export async function loginWithPassword(phoneNumber: string, password: string): Promise<LoginOutcome> {
  const res = await apiFetch('/auth/login-password', {
    method: 'POST',
    body: JSON.stringify({ phone_number: phoneNumber, password })
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
