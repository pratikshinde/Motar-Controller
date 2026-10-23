import type { HistoryPoint } from '@/api/generated/model';

/** A pump reports about once a minute; a longer silence between two "running" readings ends one run and starts the next. */
const GAP_MS = 5 * 60 * 1000;

export interface RunSession {
  startMs: number;
  /** Last "running" reading of the run. */
  endMs: number;
  /** Still running as of the newest reading we have. */
  ongoing: boolean;
}

/**
 * The runs (start time to stop time) found in raw readings. A run is a stretch of "running" readings with no gap longer
 * than five minutes. Times are the readings' own timestamps, so a stop is shown within about a minute of when it happened,
 * and nothing is invented for periods that have no readings.
 */
export function sessionsFromReadings(
  records: HistoryPoint[],
  nowMs: number = Date.now(),
  /** What the pump itself reports right now; when it says "stopped", no run is still going. */
  runningNow: boolean | null = null,
): RunSession[] {
  const on = records
    .filter((r) => r.pump_on && r.recorded_at && (r.source ?? 'raw') !== 'daily_summary')
    .map((r) => Date.parse(String(r.recorded_at)))
    .filter((ms) => !Number.isNaN(ms))
    .sort((a, b) => a - b);
  const sessions: RunSession[] = [];
  for (const ms of on) {
    const last = sessions[sessions.length - 1];
    if (last && ms - last.endMs <= GAP_MS) last.endMs = ms;
    else sessions.push({ startMs: ms, endMs: ms, ongoing: false });
  }
  const tail = sessions[sessions.length - 1];
  if (tail && runningNow !== false && nowMs - tail.endMs <= GAP_MS) tail.ongoing = true;
  return sessions;
}

export const sessionMinutes = (s: RunSession): number => Math.max(1, Math.round((s.endMs - s.startMs) / 60000) + 1);

/** Local calendar day key (yyyy-mm-dd) of an instant. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
