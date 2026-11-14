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
  owner: { id?: string; name: string; phone: string | null; email?: string | null } | null;
  farmers: number;
  /** Distributors, dealers and staff under the manufacturer. */
  team: number;
  /** Of the team: how many are distributors and how many are dealers. */
  distributors: number;
  dealers: number;
  open_alerts: number;
  pumps: PumpBuckets;
  /** Pumps on the GSM service (a modem is on their starter record), and of those the ones reporting right now. */
  gsm_pumps: number;
  gsm_online: number;
  /** When this manufacturer was added to the platform. */
  joined: string | null;
}

export interface ManufacturersOverview {
  manufacturers: ManufacturerSummary[];
  totals: PumpBuckets & {
    farmers: number;
    open_alerts: number;
    manufacturers: number;
    distributors: number;
    dealers: number;
    gsm_pumps: number;
    gsm_online: number;
    /** Pumps added in each of the last six months, oldest first. */
    monthly_pumps: { month: string; pumps: number }[];
  };
}

/** Super admin only: every pump that has a position, one pin each. */
export interface PlatformMap {
  total: number;
  pumps: { id: string; lat: number; lng: number; manufacturer: string | null }[];
}

export function fetchPlatformMap(): Promise<PlatformMap> {
  return apiJson('/brands/map');
}

/** The manufacturer the signed-in partner belongs to (its name for the portal's header), or null for a super admin. */
export function fetchMyBrand(): Promise<{ brand: { key: string; name: string; short_name: string | null; primary_color: string | null; logo_url: string | null } | null }> {
  return apiJson('/brands/mine');
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
