import type { TFunction } from 'i18next';
import { intlLocale } from './languages';

/** "just now", "5 min ago", "3 h ago", "2 days ago" in the user's language. */
export function timeAgo(t: TFunction, iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return t('time.never');
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return t('time.justNow');
  if (min < 60) return t('time.minutesAgo', { count: min });
  const hours = Math.floor(min / 60);
  if (hours < 24) return t('time.hoursAgo', { count: hours });
  return t('time.daysAgo', { count: Math.floor(hours / 24) });
}

/** 125 -> "2 h 5 min"; 45 -> "45 min". Null/undefined -> em dash (never an invented zero). */
export function formatMinutes(t: TFunction, minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return '—';
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h > 0 ? t('units.hoursMinutes', { h, m: m % 60 }) : t('units.minutes', { m });
}

/**
 * 125 -> "002:05" (HH:MM, zero-padded) for the dashboard's digital run-time readout. No seconds: the
 * backend only reports runtime in whole minutes, so a ":00" seconds place would be a fabricated reading.
 */
export function formatHM(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return '—';
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return `${String(h).padStart(3, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function formatDate(lang: string, iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(intlLocale(lang), { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(lang: string, iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(intlLocale(lang), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatClock(lang: string, when: string | number | Date): string {
  return new Date(when).toLocaleTimeString(intlLocale(lang), { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** A reading shown to one decimal, or an em dash when the pump has not reported it. */
export function formatReading(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined || Number.isNaN(value) ? '—' : value.toFixed(digits);
}
