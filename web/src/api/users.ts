import { apiJson } from './client';
import type { RoleTier, UserTreeNode, User, AccountStatus } from '../types';

// Mirrors the server's ASSIGNABLE_ROLES table (server.js) so the UI doesn't
// offer a role the API would reject anyway. The server re-validates
// regardless — this is a UX convenience, not the control.
export const ASSIGNABLE_ROLES: Record<RoleTier, RoleTier[]> = {
  // A manufacturer is a business with its own app and dashboard: it is added from the Manufacturers page, which creates it
  // together with its brand. (The API still accepts role 'manufacturer' but requires the brand.)
  // The platform owner makes manufacturers (admins) only, on the Manufacturers page; an admin makes distributors, dealers and farmers; a
  // distributor makes dealers and farmers; a dealer makes farmers. (A farmer is registered on the Farmers page, together with their starter.)
  superadmin: [],
  manufacturer: ['distributor', 'dealer', 'customer'],
  distributor: ['dealer', 'customer'],
  dealer: ['customer'],
  support: [],
  customer: []
};

export const ROLE_NAMES: Record<RoleTier, string> = {
  customer: 'End Customer / Farmer',
  superadmin: 'Super Admin (monitoring)',
  manufacturer: 'Admin',
  distributor: 'Regional Distributor',
  dealer: 'Dealer / Installer',
  support: 'Support Engineer'
};

/** The one-time sign-up QR of a distributor or dealer. `token` is what goes in the link; shown once, the server keeps no readable copy. */
export interface PartnerClaim {
  qr: string;
  token: string;
  expires_at: string;
}

/** What the QR holds: a link to the website's claim page, so an ordinary phone camera opens it. */
export function claimLinkFor(token: string): string {
  return `${window.location.origin}/claim/${encodeURIComponent(token)}`;
}

/** A fresh QR for a distributor or dealer under you: for one who has not signed in yet or who lost their password. The old QR stops working. */
export async function newPartnerQr(id: string): Promise<{ message: string; claim: PartnerClaim }> {
  return apiJson(`/users/${encodeURIComponent(id)}/qr`, { method: 'POST' });
}

export async function fetchUserTree(): Promise<{ tree: UserTreeNode[] }> {
  return apiJson('/users/tree');
}

// `phone_verification_token` is the ticket from api/phoneVerification.ts: the server refuses to create an account for a
// number nobody has answered a WhatsApp code for.
export async function createSubordinateUser(input: {
  full_name: string;
  phone_number: string;
  role: RoleTier;
  parent_user_id?: string;
  parent_hierarchy_path?: string;
  password?: string;
  phone_verification_token?: string;
}): Promise<{ message: string; user: User }> {
  return apiJson('/users', { method: 'POST', body: JSON.stringify(input) });
}

// P-1 — add a colleague to an existing org unit: same role, same device
// pool, no new hierarchy branch. parentUserId is the org node (any
// member's id resolves to the same unit server-side).
export async function createStaffUser(input: {
  full_name: string;
  phone_number: string;
  parent_user_id: string;
  org_role?: 'staff' | 'readonly';
  password?: string;
  phone_verification_token?: string;
}): Promise<{ message: string; user: User }> {
  return apiJson('/users', { method: 'POST', body: JSON.stringify({ ...input, membership: 'staff' }) });
}

export async function updateUserAccount(
  id: string,
  patch: { full_name?: string; contract_notes?: string; device_quota?: number; account_status?: AccountStatus }
): Promise<{ message: string; user: User }> {
  return apiJson(`/users/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(patch) });
}

export async function deleteUserAccount(id: string): Promise<{ message: string; deleted_id: string }> {
  return apiJson(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
