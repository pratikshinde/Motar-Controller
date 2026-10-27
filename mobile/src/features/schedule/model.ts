/**
 * The weekly ON/OFF schedule: pure rules, no UI.
 *
 * The controller has no clock, so the cloud keeps this calendar and sends START and STOP at the set times
 * (backend/app/services/schedule_runner.py). The app only edits the table. The rules below are the server's own
 * (minimum run, no overlap, a gap between rows) so a mistake shows next to its row before Save; the server has the
 * last word.
 *
 * Times are "HH:MM", 24-hour, in the schedule's time zone (India time by default). Day 0 is Monday.
 */
import type { ScheduleEntryIn, ScheduleEntryOut } from '@/api/generated/model';

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export interface Row {
  /** Only for React lists; never sent. */
  key: string;
  day: number;
  on: string;
  off: string;
  enabled: boolean;
}

export interface Limits {
  min_window_minutes: number;
  min_gap_minutes: number;
  max_rows: number;
}

export const DEFAULT_LIMITS: Limits = { min_window_minutes: 5, min_gap_minutes: 5, max_rows: 50 };

/** What is wrong with one row, and the number the message needs. */
export type RowProblem = { kind: 'order' | 'short' | 'overlap' | 'gap'; minutes?: number };

let counter = 0;
export const newKey = (): string => `row-${++counter}`;

export const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export const pad = (n: number): string => String(n).padStart(2, '0');
export const toHHMM = (minutes: number): string => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** 24-hour "HH:MM" -> the 12-hour parts a farmer reads: 13:05 -> 1, 5, PM. */
export function to12h(hhmm: string): { hour: number; minute: number; pm: boolean } {
  const total = toMinutes(hhmm);
  const h24 = Math.floor(total / 60);
  return { hour: h24 % 12 === 0 ? 12 : h24 % 12, minute: total % 60, pm: h24 >= 12 };
}

export function from12h(hour: number, minute: number, pm: boolean): string {
  return `${pad((hour % 12) + (pm ? 12 : 0))}:${pad(minute)}`;
}

/** "13:05" -> "1:05 PM". `am` and `pm` are the words in the farmer's language. */
export function display12h(hhmm: string, am: string, pm: string): string {
  const p = to12h(hhmm);
  return `${p.hour}:${pad(p.minute)} ${p.pm ? pm : am}`;
}

export const rowsFromEntries = (entries: ScheduleEntryOut[]): Row[] =>
  entries.map((e) => ({ key: newKey(), day: e.day_of_week, on: e.on_time, off: e.off_time, enabled: e.enabled }));

export const sortRows = (rows: Row[]): Row[] =>
  [...rows].sort((a, b) => a.day - b.day || toMinutes(a.on) - toMinutes(b.on));

export const entriesFromRows = (rows: Row[]): ScheduleEntryIn[] =>
  sortRows(rows).map((r) => ({ day_of_week: r.day, on_time: r.on, off_time: r.off, enabled: r.enabled }));

/** How long a row runs, as parts the screen words ("2 h 30 min"), or null if the row is not valid yet. */
export function lengthOf(on: string, off: string): { h: number; m: number } | null {
  const total = toMinutes(off) - toMinutes(on);
  return total > 0 ? { h: Math.floor(total / 60), m: total % 60 } : null;
}

export function validateRows(rows: Row[], limits: Limits = DEFAULT_LIMITS): Record<string, RowProblem> {
  const problems: Record<string, RowProblem> = {};
  for (const r of rows) {
    const length = toMinutes(r.off) - toMinutes(r.on);
    if (length <= 0) problems[r.key] = { kind: 'order' };
    else if (length < limits.min_window_minutes) problems[r.key] = { kind: 'short', minutes: limits.min_window_minutes };
  }
  for (let day = 0; day < 7; day++) {
    const sameDay = rows
      .filter((r) => r.day === day && r.enabled && !problems[r.key])
      .sort((a, b) => toMinutes(a.on) - toMinutes(b.on));
    for (let i = 1; i < sameDay.length; i++) {
      const prev = sameDay[i - 1];
      const next = sameDay[i];
      if (toMinutes(next.on) < toMinutes(prev.off)) problems[next.key] = { kind: 'overlap' };
      else if (toMinutes(next.on) - toMinutes(prev.off) < limits.min_gap_minutes)
        problems[next.key] = { kind: 'gap', minutes: limits.min_gap_minutes };
    }
  }
  return problems;
}

/** A new row for `day`: starts after the day's last row if there is one, else at 6:00 AM for two hours. */
export function newRowFor(day: number, rows: Row[]): Row {
  const sameDay = rows.filter((r) => r.day === day);
  const lastOff = sameDay.reduce((latest, r) => Math.max(latest, toMinutes(r.off)), -1);
  let on = lastOff < 0 ? 6 * 60 : lastOff + 60;
  let off = on + 120;
  if (off > 23 * 60 + 59) {
    // not enough of the day left after the last row: take the last two hours of the day
    on = 21 * 60 + 58;
    off = 23 * 60 + 58;
  }
  return { key: newKey(), day, on: toHHMM(on), off: toHHMM(off), enabled: true };
}

/** How many enabled rows there are (the "3 times a week" on the Timer page). */
export const activeCount = (entries: { enabled: boolean }[]): number => entries.filter((e) => e.enabled).length;

type Outcome =
  | 'PENDING' | 'SENT' | 'ALREADY_ON' | 'ALREADY_OFF' | 'SKIPPED_FAULT' | 'BLOCKED' | 'MISSED' | 'GAVE_UP' | 'CANCELLED';

/**
 * The words for what happened at a due time, as a translation key under `schedule.outcome` and a tone for its colour.
 * A sent command's own state decides between "Done" (the pump confirmed), "Sent" (on its way) and "Not confirmed".
 */
export function outcomeOf(outcome: string, commandStatus: string | null | undefined): { key: string; tone: 'ok' | 'info' | 'warn' | 'bad' | 'idle' } {
  switch (outcome as Outcome) {
    case 'SENT':
      if (commandStatus === 'APPLIED') return { key: 'done', tone: 'ok' };
      if (['FAILED', 'EXPIRED', 'REJECTED', 'NOT_CONFIRMED'].includes(commandStatus ?? '')) return { key: 'notConfirmed', tone: 'warn' };
      return { key: 'sent', tone: 'info' };
    case 'ALREADY_ON': return { key: 'alreadyOn', tone: 'idle' };
    case 'ALREADY_OFF': return { key: 'alreadyOff', tone: 'idle' };
    case 'SKIPPED_FAULT': return { key: 'fault', tone: 'warn' };
    case 'BLOCKED': return { key: 'paused', tone: 'warn' };
    case 'MISSED': return { key: 'missed', tone: 'bad' };
    case 'GAVE_UP': return { key: 'notConfirmed', tone: 'bad' };
    case 'CANCELLED': return { key: 'cancelled', tone: 'idle' };
    default: return { key: 'waiting', tone: 'info' };
  }
}
