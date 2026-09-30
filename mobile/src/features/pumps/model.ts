import type { PumpResponse } from '@/api/generated/model';
import { OFFLINE_AFTER_MS } from '@/config/env';

/**
 * What a pump is doing, decided from what the server has actually reported.
 * A pump that has never reported is `nodata`, and one that went quiet is `offline`:
 * neither is ever shown as "stopped", because that would tell a farmer it is safe when we do not know.
 */
export type PumpState = 'running' | 'stopped' | 'fault' | 'offline' | 'nodata';

export function pumpState(
  p: Pick<PumpResponse, 'last_seen_at' | 'fault_active' | 'status' | 'pump_on'>,
  now: number = Date.now(),
): PumpState {
  if (!p.last_seen_at) return 'nodata';
  if (now - Date.parse(p.last_seen_at) > OFFLINE_AFTER_MS) return 'offline';
  const status = (p.status ?? '').toUpperCase();
  if (p.fault_active || status === 'FAULT') return 'fault';
  if (p.pump_on === true || status === 'RUNNING') return 'running';
  return 'stopped';
}

/**
 * Is there a problem to show? A pump that went quiet while it was faulted is still faulted as far as
 * anyone knows, so the last reported fault stays visible; only a pump that reported healthy and
 * is still reporting is "healthy". Offline or never-reported pumps are neither: we do not know.
 */
export function hasKnownFault(
  p: Pick<PumpResponse, 'fault_active' | 'status' | 'last_seen_at' | 'pump_on'>,
  now: number = Date.now(),
): boolean {
  const state = pumpState(p, now);
  if (state === 'fault') return true;
  return state === 'offline' && (p.fault_active === true || (p.status ?? '').toUpperCase() === 'FAULT');
}

/** True only when the pump is reporting and reports no problem. */
export const isKnownHealthy = (
  p: Pick<PumpResponse, 'fault_active' | 'status' | 'last_seen_at' | 'pump_on'>,
  now: number = Date.now(),
): boolean => {
  const state = pumpState(p, now);
  return state === 'running' || state === 'stopped';
};

export interface PumpSection {
  key: string;
  /** null for the pumps that are not in any group. */
  title: string | null;
  pumps: PumpResponse[];
}

/**
 * Groups by the farmer's own sites (alphabetical), ungrouped pumps last. Order inside a group is
 * the order given (the server already sorts by the farmer's own arrangement).
 */
export function groupBySite(pumps: PumpResponse[]): PumpSection[] {
  const named = new Map<string, PumpSection>();
  const loose: PumpResponse[] = [];
  for (const p of pumps) {
    if (p.site_id && p.site_name) {
      const s = named.get(p.site_id) ?? { key: p.site_id, title: p.site_name, pumps: [] };
      s.pumps.push(p);
      named.set(p.site_id, s);
    } else {
      loose.push(p);
    }
  }
  const sections = [...named.values()].sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
  if (loose.length) sections.push({ key: 'ungrouped', title: null, pumps: loose });
  return sections;
}

export type PhaseIndicator = 'ok' | 'wrong' | null;

/**
 * The pump has no phase-sequence sensor reading of its own; the only thing we can honestly say is
 * derived: fault 4 is "wrong phase order", and a motor that is running without a fault has, by
 * definition, the right rotation. In any other state there is nothing to claim.
 */
export function phaseIndicator(p: Pick<PumpResponse, 'pump_on' | 'fault_active' | 'fault_code'>): PhaseIndicator {
  if (p.fault_code === 4) return 'wrong';
  if (p.pump_on === true && !p.fault_active) return 'ok';
  return null;
}

/** 0-5 signal bars, or null when the pump has not reported signal strength. */
export function signalBars(dbm: number | null | undefined): number | null {
  if (dbm === null || dbm === undefined) return null;
  return Math.max(0, Math.min(5, Math.floor((dbm + 110) / 12)));
}

export const EXPIRY_WARNING_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const BLOCKED_LIFECYCLES = ['SUSPENDED', 'RMA', 'RETIRED'];

export type PlanState =
  | { kind: 'none' }
  | { kind: 'ok'; daysLeft: number; expiresAt: string }
  | { kind: 'expiring'; daysLeft: number; expiresAt: string }
  | { kind: 'expired'; expiresAt: string }
  | { kind: 'suspended' };

export const isSuspended = (p: Pick<PumpResponse, 'lifecycle_state'>): boolean =>
  BLOCKED_LIFECYCLES.includes((p.lifecycle_state ?? '').toUpperCase());

export function planState(
  p: Pick<PumpResponse, 'lifecycle_state' | 'subscription_expires_at'>,
  now: number = Date.now(),
): PlanState {
  if (isSuspended(p)) return { kind: 'suspended' };
  if (!p.subscription_expires_at) return { kind: 'none' };
  const left = Date.parse(p.subscription_expires_at) - now;
  if (left <= 0) return { kind: 'expired', expiresAt: p.subscription_expires_at };
  const daysLeft = Math.ceil(left / DAY_MS);
  return { kind: daysLeft <= EXPIRY_WARNING_DAYS ? 'expiring' : 'ok', daysLeft, expiresAt: p.subscription_expires_at };
}

/** Remote start / stop / timer is offered unless the server will refuse it (suspended, RMA, retired). */
export const canControl = (p: Pick<PumpResponse, 'lifecycle_state'>): boolean => !isSuspended(p);

export const displayName = (p: Pick<PumpResponse, 'display_name' | 'name'>): string => p.display_name || p.name;
