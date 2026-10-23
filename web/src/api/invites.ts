import { apiJson, apiFetch, persistTokens, messageFrom } from './client';
import { isMfaRequired } from '../types';
import type { LoginOutcome, RoleTier } from '../types';

export async function createInvite(role: RoleTier, parentUserId?: string): Promise<{ message: string; token: string; role: RoleTier; expires_at: string }> {
  return apiJson('/invites', { method: 'POST', body: JSON.stringify({ role, parent_user_id: parentUserId }) });
}

// Same persist-then-return contract as verifyOtp/loginWithPassword (api/auth.ts)
// — this is a login path too, just one that also creates the account.
export async function redeemInvite(
  token: string,
  fullName: string,
  phoneNumber: string,
  password: string | undefined,
  phoneVerificationToken: string
): Promise<LoginOutcome> {
  const res = await apiFetch(`/invites/${encodeURIComponent(token)}/redeem`, {
    method: 'POST',
    body: JSON.stringify({
      full_name: fullName,
      phone_number: phoneNumber,
      password,
      phone_verification_token: phoneVerificationToken
    })
  });
  const body = (await res.json()) as LoginOutcome;
  if (!res.ok) throw new Error(messageFrom(body, 'Could not redeem invite'));
  if (!isMfaRequired(body)) persistTokens(body);
  return body;
}

export interface InvitePreview {
  role: RoleTier;
  invited_by: string;
  expires_at: string;
  /** Partner accounts sign in with a password; a customer may leave it blank and use an SMS code. */
  password_required: boolean;
}

/** What the sign-up page shows before asking for anything. Needs no session; a bad link throws with the server's message. */
export async function previewInvite(token: string): Promise<InvitePreview> {
  const res = await apiFetch(`/invites/${encodeURIComponent(token)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(messageFrom(body, 'This invite link is not valid.'));
  return body as InvitePreview;
}
