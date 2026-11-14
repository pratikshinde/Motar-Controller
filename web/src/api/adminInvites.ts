import { apiJson } from './client';

export type AdminInviteStatus = 'WAITING_FOR_CODE' | 'WAITING_FOR_PASSWORD' | 'DONE' | 'EXPIRED' | 'BLOCKED' | 'CANCELLED';

/** An admin being added: nothing but this exists until the platform owner has typed in the code the admin read out. */
export interface AdminInvite {
  id: string;
  full_name: string;
  email: string;
  company_name: string | null;
  address: string | null;
  /** +91 and ten digits. */
  phone: string | null;
  /** The manufacturer made from the company name: set once the code is confirmed. */
  brand: string | null;
  status: AdminInviteStatus;
  created_at: string | null;
  expires_at: string | null;
  user_id: string | null;
}

/** A 6-digit code is emailed to the admin. Nothing is registered yet. `phone` is the ten digits: the server adds +91. */
export const startAdminInvite = (input: { full_name: string; company_name: string; address: string; phone: string; email: string }): Promise<{ invite: AdminInvite }> =>
  apiJson('/users/admin-invites', { method: 'POST', body: JSON.stringify(input) });

/** The code the admin read out: it proves the email and registers the manufacturer and the admin (who chooses the password next). */
export const verifyAdminInvite = (id: string, code: string): Promise<{ invite: AdminInvite; user: { id: string; full_name: string; email: string } }> =>
  apiJson(`/users/admin-invites/${encodeURIComponent(id)}/verify`, { method: 'POST', body: JSON.stringify({ code: code.trim() }) });

export const resendAdminInvite = (id: string): Promise<{ invite: AdminInvite }> => apiJson(`/users/admin-invites/${encodeURIComponent(id)}/resend`, { method: 'POST' });

/** The admin forgot their password: a new code is emailed to them, and they choose a new password with it ("First time here"). */
export const sendAdminResetCode = (userId: string): Promise<{ invite: AdminInvite }> => apiJson(`/users/${encodeURIComponent(userId)}/admin-code`, { method: 'POST' });

/** Admins that were added and are not finished: waiting for the code, or for the admin to choose a password, expired or blocked. */
export const fetchAdminInvites = (): Promise<{ invites: AdminInvite[] }> => apiJson('/users/admin-invites');
