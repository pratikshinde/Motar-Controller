import type { PumpListItem } from '../types';

export type EffectiveStatus = 'RUNNING' | 'STOPPED' | 'FAULT' | 'OFFLINE' | 'NO_DATA';

/**
 * What to show for a pump. A pump that has stopped reporting is Offline whatever it last said (its last
 * "Running" means nothing now), and one that never reported has no state at all.
 */
export function effectiveStatus(p: Pick<PumpListItem, 'status' | 'connectivity'>): EffectiveStatus {
  if (p.connectivity === 'OFFLINE') return 'OFFLINE';
  if (p.connectivity === 'NEVER_SEEN') return 'NO_DATA';
  if (p.status === 'RUNNING') return 'RUNNING';
  if (p.status === 'FAULT') return 'FAULT';
  return 'STOPPED';
}

export const STATUS_LABEL: Record<EffectiveStatus, string> = {
  RUNNING: 'RUNNING',
  STOPPED: 'STOPPED',
  FAULT: 'FAULT',
  OFFLINE: 'OFFLINE',
  NO_DATA: 'NO DATA YET'
};

/** "18.5200°N, 73.8600°E", or an em-dash when the position is not known (never a made-up 0, 0). */
export function formatCoords(lat: unknown, lon: unknown): string {
  const la = lat === null || lat === undefined || lat === '' ? NaN : Number(lat);
  const lo = lon === null || lon === undefined || lon === '' ? NaN : Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return '—';
  return `${la.toFixed(4)}°N, ${lo.toFixed(4)}°E`;
}
