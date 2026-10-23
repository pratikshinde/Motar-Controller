import type { TFunction } from 'i18next';
import { onlineManager } from '@tanstack/react-query';
import { API_ORIGIN } from '@/config/env';

export type ErrorContext = 'login' | 'register' | 'command' | 'load';

/**
 * Turns any failed API call into a sentence in the user's language.
 *
 * The server's `detail` text is English and written for developers, so it is
 * never shown. We decide from the HTTP status and, where the server sends one,
 * its machine-readable `error.code` (SRS FR-CLD-040).
 */
/**
 * Development builds only (never in a release, never in tests): the technical reason, shown under the friendly
 * sentence, so "can't connect" on a phone says WHICH server it tried and what the network said.
 */
const SHOW_TECHNICAL_DETAILS = __DEV__ && typeof process.env.JEST_WORKER_ID === 'undefined';

function technicalDetails(err: unknown): string {
  const e = err as { name?: string; code?: string; message?: string; issues?: { path?: unknown[]; message?: string }[] };
  if (e?.name === 'ContractError') {
    const first = e.issues?.[0];
    return `[dev] ${e.message ?? 'unexpected response'} | ${first?.path?.join('.') ?? ''}: ${first?.message ?? ''}`;
  }
  return `[dev] server ${API_ORIGIN} | ${e?.code ?? 'no code'} | ${e?.message ?? 'no message'}`;
}

export function friendlyError(err: unknown, t: TFunction, context: ErrorContext = 'load'): string {
  const text = friendlyErrorText(err, t, context);
  const e = err as { name?: string; response?: unknown };
  const noAnswerOrContract = !e?.response || e?.name === 'ContractError';
  return SHOW_TECHNICAL_DETAILS && noAnswerOrContract ? `${text}

${technicalDetails(err)}` : text;
}

function friendlyErrorText(err: unknown, t: TFunction, context: ErrorContext): string {
  const e = err as {
    name?: string;
    response?: { status: number; data?: { error?: { code?: string; params?: { seconds?: number } } } };
  };
  if (e?.name === 'ContractError') return t('errors.contract');

  const res = e?.response;
  if (!res) return onlineManager.isOnline() ? t('errors.network') : t('errors.offline'); // no answer at all

  const status: number = res.status;
  const info = res.data?.error; // { code, message_key, params } on AppError / rate limit
  const code: string | undefined = info?.code;

  if (code === 'COOLDOWN_ACTIVE') return t('command.cooldown', { seconds: info?.params?.seconds ?? '' });
  if (code === 'DEVICE_SUSPENDED') return t('errors.deviceSuspended');
  if (code === 'SITE_NAME_EXISTS') return t('errors.siteExists');
  if (code === 'MFA_REQUIRED') return t('errors.mfaUnsupported');
  // Several manufacturers' apps share one server (see mobile/brands): these say why this app cannot be used.
  if (code === 'WRONG_BRAND_APP') return t('errors.wrongBrandApp');
  if (code === 'BRAND_DISABLED') return t('errors.brandDisabled');
  if (code === 'BRAND_UNKNOWN') return t('errors.brandUnknown');
  if (code === 'RATE_LIMIT_EXCEEDED' || status === 429) return t('errors.tooMany');

  switch (status) {
    case 400:
      // Registering with a number that already exists is the only 400 the app can trigger there.
      return context === 'register' ? t('errors.alreadyRegistered') : t('errors.invalid');
    case 401:
      return context === 'login' ? t('errors.wrongPassword') : t('errors.sessionExpired');
    case 403:
      if (context === 'register') return t('errors.registrationClosed');
      if (context === 'login') return t('errors.suspended');
      return t('errors.forbidden');
    case 404:
      return t('errors.notFound');
    case 409:
      return t('errors.invalid');
    case 422:
      return t('errors.invalid');
    default:
      return status >= 500 ? t('errors.server') : t('errors.generic');
  }
}

/** The cooldown the server asked for, from its error envelope or Retry-After header. */
export function cooldownSecondsFrom(err: unknown): number | null {
  const e = err as {
    response?: {
      status: number;
      headers?: Record<string, string>;
      data?: { error?: { code?: string; params?: { seconds?: number } } };
    };
  };
  if (e?.response?.data?.error?.code !== 'COOLDOWN_ACTIVE') return null;
  const fromBody = e.response.data.error.params?.seconds;
  if (typeof fromBody === 'number') return fromBody;
  const header = Number(e.response.headers?.['retry-after']);
  return Number.isFinite(header) && header > 0 ? header : null;
}
