/**
 * What a distributor needs to see about a running pump, worded the way the farmer's app and the starter's own display word it:
 * the fault's name, whether it is a current or a voltage fault, the GSM signal, how long ago the pump was heard, and run time.
 * (The same rules as mobile/src/features/faults/info.ts and mobile/src/features/pumps/model.ts.)
 */

/** The starter's own wording (MotorProtection.c); identical to backend app/services/alert_sms.py. */
export const FAULT_NAMES: Record<number, string> = {
  1: 'Phase Fail',
  2: 'Phase Fail',
  3: 'Over voltage',
  4: 'Line reverse: interchange R and B',
  5: 'Dry Run Fault',
  6: 'Cable open',
  7: 'Cable open (OR) Motor Faults',
  8: 'Over load',
  9: 'Motor Fault',
  10: 'Low voltage'
};

export type FaultKind = 'voltage' | 'current';

/** Codes 1-4 (and 10) are voltage faults that clear when the supply is right again; 5-9 are current faults that need a reset. */
export function faultKind(code: number | null | undefined): FaultKind | null {
  if (typeof code !== 'number') return null;
  if ((code >= 1 && code <= 4) || code === 10) return 'voltage';
  if (code >= 5 && code <= 9) return 'current';
  return null;
}

export function faultText(code: number | null | undefined): { kind: FaultKind | null; name: string; action: string } {
  const kind = faultKind(code);
  const name = typeof code === 'number' ? FAULT_NAMES[code] ?? `Fault ${code}` : 'Fault';
  const action =
    kind === 'voltage'
      ? 'Voltage fault: it clears by itself when the supply is right again.'
      : kind === 'current'
        ? 'Current fault: the pump stays stopped until someone resets the starter at the pump.'
        : 'The starter reported a fault. Check the pump.';
  return { kind, name, action };
}

export type GsmQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'none';

/** Bars for the modem's signal in dBm: -89 and better is 4 bars, then -97, -105 and -113. No reading is no bars. */
export function gsmLevel(dbm: number | null | undefined): { bars: 0 | 1 | 2 | 3 | 4; quality: GsmQuality } {
  if (typeof dbm !== 'number' || !Number.isFinite(dbm) || dbm <= -113 || dbm >= 0) return { bars: 0, quality: 'none' };
  if (dbm >= -89) return { bars: 4, quality: 'excellent' };
  if (dbm >= -97) return { bars: 3, quality: 'good' };
  if (dbm >= -105) return { bars: 2, quality: 'fair' };
  return { bars: 1, quality: 'poor' };
}

/** "2h 05m" style for a day's run time, "—" when unknown. */
export function formatMinutes(minutes: number | null | undefined): string {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0) return '—';
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Total run time as hours and minutes (HH:MM), the way the app shows it. */
export function formatHM(minutes: number | null | undefined): string {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0) return '—';
  const m = Math.round(minutes);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** How long ago the pump was last heard: "just now", "45 s ago", "3 min ago", "2 h ago", "4 d ago"; "never" when it has not reported. */
export function heardAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'never';
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return 'never';
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec} s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

export interface PumpProblem {
  key: 'fault' | 'open-faults' | 'offline' | 'power';
  severity: 'error' | 'warning';
  title: string;
  detail: string;
}

type ProblemInput = {
  status?: string | null;
  connectivity?: string | null;
  fault_active?: boolean | null;
  fault_code?: number | null;
  last_seen_at?: string | null;
  power_state?: string | null;
  power_changed_at?: string | null;
  power_source?: string | null;
};

/**
 * Everything wrong with a pump right now, in the order it matters, for the strip at the top of the pump's page: a fault the starter reports,
 * faults nobody has resolved yet, a pump that stopped reporting, and the power being off. An empty list means nothing is wrong.
 */
export function pumpProblems(pump: ProblemInput, openFaultCount: number, now: number = Date.now()): PumpProblem[] {
  const problems: PumpProblem[] = [];
  if (pump.status === 'FAULT' || pump.fault_active) {
    const f = faultText(pump.fault_code);
    problems.push({ key: 'fault', severity: 'error', title: `Fault: ${f.name}`, detail: f.action });
  }
  if (openFaultCount > 0) {
    problems.push({
      key: 'open-faults',
      severity: 'warning',
      title: `${openFaultCount} unresolved fault event${openFaultCount === 1 ? '' : 's'}`,
      detail: 'See Events & Logs, and acknowledge each one once it has been dealt with.',
    });
  }
  if (pump.connectivity === 'OFFLINE') {
    problems.push({
      key: 'offline',
      severity: 'warning',
      title: 'Pump is not reporting',
      detail: `Last heard ${heardAgo(pump.last_seen_at, now)}. The power may be off, or there is no mobile signal.`,
    });
  }
  if (pump.power_state === 'OFF') {
    const since = pump.power_changed_at ? ` since ${new Date(pump.power_changed_at).toLocaleString()}` : '';
    problems.push({
      key: 'power',
      severity: 'warning',
      title: pump.power_source === 'CONTACT' ? `Power may be off${since}` : `Power is off${since}`,
      detail:
        pump.power_source === 'CONTACT'
          ? 'The starter stopped reporting, which is how a power cut looks from here.'
          : 'The starter reports no line voltage.',
    });
  }
  return problems;
}
