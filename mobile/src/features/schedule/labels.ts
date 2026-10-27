import type { TFunction } from 'i18next';
import type { ScheduleNextOut } from '@/api/generated/model';
import { DAY_KEYS, display12h, lengthOf } from './model';

/** "11:00 AM" in the farmer's language (AM / PM are translated). */
export const timeLabel = (hhmm: string, t: TFunction): string => display12h(hhmm, t('schedule.am'), t('schedule.pm'));

export const dayName = (day: number, t: TFunction): string => t(`schedule.day.${DAY_KEYS[day]}`);
export const dayShort = (day: number, t: TFunction): string => t(`schedule.dayShort.${DAY_KEYS[day]}`);

/** "Mon 11:00 AM", worded here (not by the server) so it is in the farmer's language. */
export const momentLabel = (day: number, hhmm: string, t: TFunction): string => `${dayShort(day, t)} ${timeLabel(hhmm, t)}`;

/**
 * "Next: switch ON Mon 11:00 AM", or null when the server did not say when. A decoration must never take the page down:
 * the response contract check rejects a wrong-shaped answer first, and this is the second line of defence.
 */
export const nextLabel = (next: Pick<ScheduleNextOut, 'kind' | 'day_of_week' | 'time'> | null | undefined, t: TFunction): string | null => {
  if (!next || typeof next.time !== 'string' || typeof next.day_of_week !== 'number') return null;
  return t('schedule.cardNext', {
    what: next.kind === 'START' ? t('schedule.whatOn') : t('schedule.whatOff'),
    when: momentLabel(next.day_of_week, next.time, t),
  });
};

/** "Runs 2 h 30 min", or null for a row that is not valid yet. */
export function lengthLabel(on: string, off: string, t: TFunction): string | null {
  const len = lengthOf(on, off);
  if (!len) return null;
  if (len.h && len.m) return t('schedule.lengthHM', { h: len.h, m: len.m });
  return len.h ? t('schedule.lengthH', { h: len.h }) : t('schedule.lengthM', { m: len.m });
}
