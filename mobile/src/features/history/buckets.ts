import type { HistoryPoint } from '@/api/generated/model';

const HOUR_MS = 60 * 60 * 1000;

export interface HourBar {
  /** Start of the hour (epoch ms). */
  startMs: number;
  /** Estimated minutes running in this hour (one running reading is about one minute). */
  minutes: number;
}

/**
 * The last 24 hours as 24 hourly bars, from raw readings. The pump reports about once a minute,
 * so the number of "running" readings in an hour is its running minutes for that hour.
 */
export function hourlyBars(records: HistoryPoint[], now: number = Date.now()): HourBar[] {
  const end = Math.floor(now / HOUR_MS) * HOUR_MS + HOUR_MS;
  const start = end - 24 * HOUR_MS;
  const bars: HourBar[] = Array.from({ length: 24 }, (_, i) => ({ startMs: start + i * HOUR_MS, minutes: 0 }));
  for (const r of records) {
    if (!r.pump_on || !r.recorded_at) continue;
    const t = Date.parse(r.recorded_at);
    if (Number.isNaN(t) || t < start || t >= end) continue;
    bars[Math.floor((t - start) / HOUR_MS)].minutes += 1;
  }
  for (const b of bars) b.minutes = Math.min(60, b.minutes);
  return bars;
}

export interface DayBar {
  /** ISO date (yyyy-mm-dd) of the day the rollup covers. */
  day: string;
  minutes: number;
  starts: number | null;
  faults: number | null;
}

/** Daily rollups (week / month) as bars, oldest first. */
export function dailyBars(records: HistoryPoint[]): DayBar[] {
  return records
    .filter((r) => r.source === 'daily_summary' && r.recorded_at)
    .map((r) => ({
      day: String(r.recorded_at).slice(0, 10),
      minutes: r.runtime_min ?? 0,
      starts: r.start_count ?? null,
      faults: r.fault_count ?? null,
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export const sumMinutes = (bars: { minutes: number }[]): number => bars.reduce((s, b) => s + b.minutes, 0);
