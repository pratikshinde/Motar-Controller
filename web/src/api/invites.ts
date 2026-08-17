import { apiJson, apiFetch, persistTokens } from './client';
import { isMfaRequired } from '../types';
import type { LoginOutcome, RoleTier } from '../types';

export async function createInvite(role: RoleTier, parentUserId?: string): Promise<{ message: string; token: string; role: RoleTier; expires_at: string }> {
  return apiJson('/invites', { method: 'POST', body: JSON.stringify({ role, parent_user_id: parentUserId }) });
}

// Same persist-then-return contract as verifyOtp/loginWithPassword (api/auth.ts)
// — this is a login path too, just one that also creates the account.
export async function redeemInvite(token: string, fullName: string, phoneNumber: string, password?: string): Promise<LoginOutcome> {
  const res = await apiFetch(`/invites/${encodeURIComponent(token)}/redeem`, {
    method: 'POST',
    body: JSON.stringify({ full_name: fullName, phone_number: phoneNumber, password })
  });
  const body = (await res.json()) as LoginOutcome;
  if (!res.ok) throw new Error((body as any).error || 'Could not redeem invite');
  if (!isMfaRequired(body)) persistTokens(body);
  return body;
}
