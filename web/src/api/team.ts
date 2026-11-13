import { apiJson } from './client';
import type { PumpBuckets } from './brands';

/** The numbers for one account and everything under it. */
export interface TeamNumbers {
  pumps: PumpBuckets;
  /** Pumps on the GSM service (a modem on their starter record), and of those the ones reporting right now. */
  gsm_pumps: number;
  gsm_online: number;
  distributors: number;
  dealers: number;
  farmers: number;
}

/** One distributor, dealer or farmer under the signed-in account, with the numbers for what is under them. */
export interface TeamMember extends TeamNumbers {
  id: string;
  role: 'distributor' | 'dealer' | 'customer';
  full_name: string;
  phone_number: string | null;
  email: string | null;
  address: string | null;
  account_status: 'ACTIVE' | 'SUSPENDED';
  /** A distributor or dealer added by QR has no password until they open it. Null for a farmer (who signs in on the app). */
  has_signed_in: boolean | null;
  created_at: string | null;
  /** Who they sit under, the one just below the signed-in account first. Empty = directly under it. */
  above: { id: string; name: string; role: string }[];
}

export interface TeamSummary extends TeamNumbers {
  /** Pumps added in each of the last six months, oldest first. */
  monthly_pumps: { month: string; pumps: number }[];
  /** Distributors and dealers added but whose QR has not been opened yet. */
  waiting_to_sign_in: number;
}

export interface Team {
  summary: TeamSummary;
  people: TeamMember[];
}

/** The signed-in account's whole tree: its own numbers and a card's worth of numbers for every distributor, dealer and farmer in it. */
export function fetchTeam(): Promise<Team> {
  return apiJson('/users/team');
}

export const LEVEL_LABEL: Record<TeamMember['role'], { one: string; many: string }> = {
  distributor: { one: 'Distributor', many: 'Distributors' },
  dealer: { one: 'Dealer', many: 'Dealers' },
  customer: { one: 'Farmer', many: 'Farmers' }
};

/** "Suresh Patil › Ramesh Traders", or "Direct" when they sit straight under the signed-in account. */
export const lineageOf = (m: TeamMember) => (m.above.length ? m.above.map(a => a.name).join(' › ') : 'Direct');
