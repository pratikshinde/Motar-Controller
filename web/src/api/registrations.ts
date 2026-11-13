import { apiJson, apiFetch, persistTokens, messageFrom, toAuthResult } from './client';
import type { LoginOutcome, RoleTier } from '../types';

export type RegistrationStatus = 'WAITING' | 'SCANNED' | 'COMPLETED' | 'EXPIRED' | 'BLOCKED' | 'CANCELLED';

/** A distributor or dealer being registered: nothing but this exists until the new person has scanned the QR and typed the password. */
export interface Registration {
  id: string;
  role: 'distributor' | 'dealer';
  full_name: string;
  address: string;
  phone_number: string;
  status: RegistrationStatus;
  created_at: string | null;
  expires_at: string | null;
  scanned_at: string | null;
  /** The one-time password: present once, right after the QR is scanned. Send it to the new person. */
  password: string | null;
}

export interface RegistrationQr {
  token: string;
  expires_at: string;
}

/** What the QR holds: a link to the page the new person types their mobile number and password on. */
export function registrationLinkFor(token: string): string {
  return `${window.location.origin}/register/${encodeURIComponent(token)}`;
}

// ---- the admin's side
export async function startRegistration(input: {
  full_name: string;
  address: string;
  phone_number: string;
  role: RoleTier;
  parent_user_id?: string;
}): Promise<{ registration: Registration; qr: RegistrationQr }> {
  return apiJson('/users/registrations', { method: 'POST', body: JSON.stringify(input) });
}

export async function fetchRegistrations(): Promise<{ registrations: Registration[] }> {
  return apiJson('/users/registrations');
}

/** Where one registration stands. Once the QR is scanned this also carries the one-time password (once). */
export async function fetchRegistration(id: string): Promise<{ registration: Registration }> {
  return apiJson(`/users/registrations/${encodeURIComponent(id)}`);
}

export async function newRegistrationQr(id: string): Promise<{ registration: Registration; qr: RegistrationQr }> {
  return apiJson(`/users/registrations/${encodeURIComponent(id)}/qr`, { method: 'POST' });
}

export async function newRegistrationPassword(id: string): Promise<{ registration: Registration }> {
  return apiJson(`/users/registrations/${encodeURIComponent(id)}/password`, { method: 'POST' });
}

export async function cancelRegistration(id: string): Promise<{ message: string }> {
  return apiJson(`/users/registrations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ---- the new person's side (no sign-in yet)
export interface RegistrationGreeting {
  first_name: string;
  role: 'distributor' | 'dealer';
  registered_by: string | null;
  brand: string | null;
}

async function publicPost<T>(path: string, body: unknown, fallback: string): Promise<T> {
  const res = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(messageFrom(json, fallback));
  return json as T;
}

/** The QR was opened: this is what makes the password appear on the admin's page. */
export const scanRegistration = (token: string) => publicPost<RegistrationGreeting>('/auth/registration/scan', { token }, 'This link is not valid any more.');

export const verifyRegistration = (token: string, phone: string, code: string) =>
  publicPost<{ ticket: string }>('/auth/registration/verify', { token, phone: phone.trim(), code: code.trim() }, 'The mobile number or the password is not right.');

/** They chose their own password: the account is created now, and they are signed in. */
export async function completeRegistration(token: string, ticket: string, password: string): Promise<LoginOutcome> {
  const body = await publicPost<any>('/auth/registration/complete', { token, ticket, password }, 'Could not finish the registration.');
  const result = toAuthResult(body);
  persistTokens(result);
  return result;
}
