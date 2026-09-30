import type { TFunction } from 'i18next';

/**
 * Fault-code names in the user's language. Codes follow SRS 6.2 (firmware
 * MotorProtection.h); the wording lives in locales/*.json as faults.code<N>.
 * An unrecognised non-zero code still reads as a fault rather than vanishing.
 */
export function faultName(t: TFunction, code: number): string {
  const key = `faults.code${code}`;
  return t(key, { defaultValue: t('faults.unknown', { code }) });
}
