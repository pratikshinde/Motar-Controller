import { apiJson } from './client';

export type QrState = 'PENDING' | 'CLAIMED' | 'REVOKED' | 'EXPIRED' | 'NONE';

export interface FarmerQr {
  state: QrState;
  expires_at: string | null;
  claimed_at: string | null;
  /** The text inside the QR. Only present right after the QR is made: the server cannot show it again. */
  payload?: string;
}

export interface FarmerPump {
  id: string;
  name: string;
  hp_rating: number | null;
  status: string | null;
  lifecycle_state: string | null;
}

export interface FarmerSummary {
  id: string;
  full_name: string;
  phone_number: string;
  address: string | null;
  /** ACTIVE, or SUSPENDED when the Ajanta admin has stopped the farmer's access. */
  status?: 'ACTIVE' | 'SUSPENDED';
}

export interface FarmerRow extends FarmerSummary {
  created_at: string | null;
  pumps: FarmerPump[];
  qr: FarmerQr;
}

export interface FarmerForm {
  full_name: string;
  address: string;
  phone: string;
  starter_id: string;
  capacity_hp: number;
}

export interface FarmerRegistered {
  message: string;
  farmer: FarmerSummary;
  pump: FarmerPump;
  qr: FarmerQr;
}

/** One request: creates the farmer, hands them the starter, and returns the one-time QR. */
export function registerFarmer(input: FarmerForm): Promise<FarmerRegistered> {
  return apiJson('/farmers', { method: 'POST', body: JSON.stringify(input) });
}

export function fetchFarmers(): Promise<{ farmers: FarmerRow[] }> {
  return apiJson('/farmers');
}

/** A new QR for a farmer (lost phone, expired QR). The older ones stop working. */
export function newFarmerQr(farmerId: string): Promise<{ message: string; farmer: FarmerSummary; qr: FarmerQr }> {
  return apiJson(`/farmers/${encodeURIComponent(farmerId)}/qr`, { method: 'POST' });
}

/** Fix a farmer's name, address or mobile number (only the fields given change). */
export function updateFarmer(farmerId: string, changes: { full_name?: string; address?: string; phone?: string }): Promise<{ message: string; farmer: FarmerSummary }> {
  return apiJson(`/farmers/${encodeURIComponent(farmerId)}`, { method: 'PATCH', body: JSON.stringify(changes) });
}

/** Stop a farmer's access (their phone is signed out); the farmer, the pump and the history are kept. */
export function deactivateFarmer(farmerId: string): Promise<{ message: string; farmer: FarmerSummary }> {
  return apiJson(`/farmers/${encodeURIComponent(farmerId)}/deactivate`, { method: 'POST' });
}

export function activateFarmer(farmerId: string): Promise<{ message: string; farmer: FarmerSummary }> {
  return apiJson(`/farmers/${encodeURIComponent(farmerId)}/activate`, { method: 'POST' });
}
