import { apiJson, persistTokens } from './client';
import type { AuthResult } from '../types';

export async function setupMfa(): Promise<{ secret: string; otpauth_url: string }> {
  return apiJson('/auth/mfa/setup', { method: 'POST' });
}

export async function enableMfa(code: string): Promise<{ message: string }> {
  return apiJson('/auth/mfa/enable', { method: 'POST', body: JSON.stringify({ code }) });
}

export async function disableMfa(code: string): Promise<{ message: string }> {
  return apiJson('/auth/mfa/disable', { method: 'POST', body: JSON.stringify({ code }) });
}

export async function verifyMfa(mfaToken: string, code: string): Promise<AuthResult> {
  const result = await apiJson<AuthResult>('/auth/mfa/verify', {
    method: 'POST',
    body: JSON.stringify({ mfa_token: mfaToken, code })
  });
  persistTokens(result);
  return result;
}
