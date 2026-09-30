import { apiJson, persistTokens, toAuthResult, updateStoredUser } from './client';
import type { AuthResult } from '../types';

export async function setupMfa(): Promise<{ secret: string; otpauth_url: string; qr_code?: string }> {
  return apiJson('/auth/mfa/setup', { method: 'POST' });
}

/** The secret goes in the body, never the URL, so it cannot end up in an access log. */
export async function enableMfa(secret: string, code: string): Promise<{ message: string }> {
  const res = await apiJson<{ message: string }>('/auth/mfa/enable', { method: 'POST', body: JSON.stringify({ code, secret }) });
  updateStoredUser({ totp_enabled: true });
  return res;
}

export async function disableMfa(code: string): Promise<{ message: string }> {
  return apiJson('/auth/mfa/disable', { method: 'POST', body: JSON.stringify({ code }) });
}

export async function verifyMfa(mfaToken: string, code: string): Promise<AuthResult> {
  const result = toAuthResult(
    await apiJson('/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ temp_token: mfaToken, totp_code: code }) })
  );
  persistTokens(result);
  return result;
}
