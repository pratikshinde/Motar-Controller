import { apiFetch, apiJson, persistTokens, clearSession, getRefreshToken, getAuthToken } from './client';
import { isMfaRequired } from '../types';
import type { LoginOutcome } from '../types';

export async function sendSmsOtp(phoneNumber: string) {
  const res = await apiFetch('/auth/send-otp', {
    method: 'POST',
    body: JSON.stringify({ phone_number: phoneNumber })
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'OTP request failed');
  return body as { message: string; phone_number: string; dev_otp?: string };
}

export async function verifyOtp(phoneNumber: string, otpCode: string): Promise<LoginOutcome> {
  const res = await apiFetch('/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ phone_number: phoneNumber, otp_code: otpCode })
  });
  const body = (await res.json()) as LoginOutcome;
  if (!res.ok) throw new Error((body as any).error || 'Authentication failed');
  if (!isMfaRequired(body)) persistTokens(body);
  return body;
}

export async function loginWithPassword(phoneNumber: string, password: string): Promise<LoginOutcome> {
  const res = await apiFetch('/auth/login-password', {
    method: 'POST',
    body: JSON.stringify({ phone_number: phoneNumber, password })
  });
  const body = (await res.json()) as LoginOutcome;
  if (!res.ok) throw new Error((body as any).error || 'Authentication failed');
  if (!isMfaRequired(body)) persistTokens(body);
  return body;
}

export async function logout() {
  try {
    if (getAuthToken()) {
      await apiFetch('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: getRefreshToken() })
      });
    }
  } catch {
    // Best-effort server-side revocation; local session is cleared regardless.
  }
  clearSession();
}

export { apiJson };
