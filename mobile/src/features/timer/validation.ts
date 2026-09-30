/** The panel's own limits for a run timer; the server enforces the same ranges. */
export const TIMER_LIMITS = {
  on: { min: 1, max: 250 },
  off: { min: 0, max: 250 },
  cycles: { min: 0, max: 999 },
} as const;

export interface TimerForm {
  on: string;
  off: string;
  cycles: string;
}

export interface TimerValue {
  on: number;
  off: number;
  cycles: number;
}

export type TimerErrors = Partial<Record<keyof TimerForm, true>>;

const whole = (s: string): number | null => (/^\d{1,4}$/.test(s.trim()) ? Number(s.trim()) : null);
const within = (n: number | null, lim: { min: number; max: number }): n is number =>
  n !== null && n >= lim.min && n <= lim.max;

export function parseTimer(form: TimerForm): { ok: true; value: TimerValue } | { ok: false; errors: TimerErrors } {
  const on = whole(form.on);
  const off = whole(form.off);
  const cycles = whole(form.cycles);
  const errors: TimerErrors = {};
  if (!within(on, TIMER_LIMITS.on)) errors.on = true;
  if (!within(off, TIMER_LIMITS.off)) errors.off = true;
  if (!within(cycles, TIMER_LIMITS.cycles)) errors.cycles = true;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { on: on as number, off: off as number, cycles: cycles as number } };
}

/** Run once and stop, or run / rest repeatedly. */
export const timerMode = (v: TimerValue): 'ON_TIMER' | 'CYCLIC' =>
  v.off > 0 && v.cycles !== 1 ? 'CYCLIC' : 'ON_TIMER';

export function clampTo(value: number, lim: { min: number; max: number }): number {
  return Math.min(lim.max, Math.max(lim.min, value));
}

export const timerToRequest = (v: TimerValue) => ({
  on_duration_minutes: v.on,
  off_duration_minutes: v.off,
  cycle_count: v.cycles,
  mode: timerMode(v),
});
