import { apiJson } from './client';

export interface PumpBuckets {
  total: number;
  running: number;
  stopped: number;
  fault: number;
  offline: number;
  no_data: number;
}

export interface ManufacturerSummary {
  key: string;
  name: string;
  short_name: string | null;
  logo_url: string | null;
  primary_color: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  /** The manufacturer's own account; null until one has been created. */
  owner: { name: string; phone: string } | null;
  farmers: number;
  /** Distributors, dealers and staff under the manufacturer. */
  team: number;
  open_alerts: number;
  pumps: PumpBuckets;
}

export interface ManufacturersOverview {
  manufacturers: ManufacturerSummary[];
  totals: PumpBuckets & { farmers: number; open_alerts: number };
}

/** Super admin only: every manufacturer with its farmers, pumps and open problems. */
export function fetchManufacturersOverview(): Promise<ManufacturersOverview> {
  return apiJson('/brands/overview');
}

export interface NewManufacturerBrand {
  key: string;
  name: string;
  short_name?: string;
  primary_color?: string;
  support_name?: string;
  support_phone?: string;
  support_email?: string;
}

export function createManufacturerBrand(input: NewManufacturerBrand): Promise<{ message: string }> {
  return apiJson('/brands', { method: 'POST', body: JSON.stringify(input) });
}

/** Switching a manufacturer's app off stops it at once for every farmer; switching it on restores it. */
export function setManufacturerStatus(key: string, status: 'ACTIVE' | 'SUSPENDED'): Promise<{ message: string }> {
  return apiJson(`/brands/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ status }) });
}

/** The manufacturer's own account: the first one becomes the owner of the brand (its tree is the manufacturer's dashboard). */
export function createManufacturerAccount(input: {
  brand: string;
  full_name: string;
  phone_number: string;
  password: string;
  phone_verification_token: string;
}): Promise<{ message: string }> {
  return apiJson('/users', { method: 'POST', body: JSON.stringify({ ...input, role: 'manufacturer' }) });
}
