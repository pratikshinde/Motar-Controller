// Ported from web/index.html's apiFetch/persistTokens (auth flow hardened
// in the 17 Aug security pass — see web/ARCHITECTURE_DECISION.md). This is
// the reference implementation of the API contract; behaviour is preserved
// exactly, only the transport (fetch → typed client) changed.
import type { AuthResult, User } from '../types';
import { getViewing, setViewing } from './viewing';

export const API_BASE = '/api';

const TOKEN_KEY = 'agripump_token';
const REFRESH_KEY = 'agripump_refresh';
const USER_KEY = 'agripump_user';

let authToken = localStorage.getItem(TOKEN_KEY) || '';
let refreshTokenValue = localStorage.getItem(REFRESH_KEY) || '';

/** A readable message from any error body the API produces: {detail}, {error:{message_key}}, {error}, {message}. */
export function messageFrom(body: any, fallback = ''): string {
  if (!body) return fallback;
  if (typeof body.detail === 'string') return body.detail;
  if (Array.isArray(body.detail)) return body.detail.map((d: any) => d?.msg).filter(Boolean).join('; ') || fallback;
  if (typeof body.error === 'string') return body.error;
  return body.error?.message || body.message || fallback;
}

/** The API's user record -> the shape the portal uses (`mfa_enabled` is `totp_enabled` here, `status` is `account_status`). */
export function normalizeUser(u: any): User {
  return {
    ...u,
    phone_number: u.phone_number ?? u.phone ?? '',
    totp_enabled: u.totp_enabled ?? u.mfa_enabled ?? false,
    account_status: u.account_status ?? u.status
  } as User;
}

/** The API's login / refresh / MFA-verify body -> AuthResult (`access_token` is `token`, `refresh_token` is `refreshToken`). */
export function toAuthResult(body: any): AuthResult {
  return {
    token: body.access_token ?? body.token,
    refreshToken: body.refresh_token ?? body.refreshToken,
    mfa_setup_required: Boolean(body.mfa_setup_required),
    user: body.user ? normalizeUser(body.user) : undefined
  } as AuthResult;
}

export function getStoredUser() {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function hasSession() {
  return Boolean(authToken && getStoredUser());
}

/** Patch the persisted user record in place (e.g. after MFA enable/disable,
 * which don't return a fresh token pair). The next silent refresh would
 * eventually correct this anyway, but there's no reason to wait ~15 min. */
export function updateStoredUser(patch: Partial<import('../types').User>) {
  const current = getStoredUser();
  if (!current) return;
  localStorage.setItem(USER_KEY, JSON.stringify({ ...current, ...patch }));
}

function persistTokens(data: AuthResult) {
  authToken = data.token;
  refreshTokenValue = data.refreshToken || refreshTokenValue;
  localStorage.setItem(TOKEN_KEY, authToken);
  if (data.refreshToken) localStorage.setItem(REFRESH_KEY, data.refreshToken);
  if (data.user) localStorage.setItem(USER_KEY, JSON.stringify(data.user));
}

export function clearSession() {
  authToken = '';
  refreshTokenValue = '';
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
  setViewing(null);
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  // The platform owner looking at one manufacturer's portal: every request is answered as that manufacturer, read-only.
  const viewing = getViewing();
  if (viewing) headers['X-View-Manufacturer'] = viewing.key;
  return headers;
}

let refreshInFlight: Promise<AuthResult | null> | null = null;

class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    super(messageFrom(body, `Request failed (${status})`));
    this.status = status;
    this.body = body;
  }
}

/**
 * Access tokens are short-lived (15 min — FR-CLD-041), so a session that
 * outlives that needs a silent refresh rather than a forced re-login. On a
 * 401/403 this tries POST /api/auth/refresh once and retries the original
 * request before giving up and clearing the session.
 */
// Requests that are themselves part of signing in: a 401 there means "wrong credentials", not "session expired".
const AUTH_ENTRY = ['/auth/login', '/auth/verify-otp', '/auth/send-otp', '/auth/refresh', '/auth/mfa/verify'];

/** Auth + JSON headers merged with the caller's. A file upload (FormData) must not claim to be JSON: the browser has to
 * set the multipart content type itself, boundary included. */
function requestHeaders(options: RequestInit): Record<string, string> {
  const merged = { ...authHeaders(), ...(options.headers as Record<string, string> | undefined) };
  if (typeof FormData !== 'undefined' && options.body instanceof FormData) delete merged['Content-Type'];
  return merged;
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const mergedHeaders = requestHeaders(options);
  let response = await fetch(url, { ...options, headers: mergedHeaders });

  // A privileged account that has not set up TOTP yet may only do that: tell the shell to show the setup step.
  if (response.status === 403 && authToken) {
    const body = await response.clone().json().catch(() => null);
    if (body?.error?.code === 'MFA_SETUP_REQUIRED') window.dispatchEvent(new CustomEvent('agripump:mfa-setup-required'));
  }

  if (response.status === 401 && authToken && !AUTH_ENTRY.some(p => path.startsWith(p))) {
    if (refreshTokenValue) {
      if (!refreshInFlight) {
        refreshInFlight = fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshTokenValue })
        })
          .then(async r => (r.ok ? toAuthResult(await r.json()) : null))
          .finally(() => {
            refreshInFlight = null;
          });
      }
      const refreshed = await refreshInFlight;
      if (refreshed && refreshed.token) {
        persistTokens(refreshed);
        return fetch(url, { ...options, headers: requestHeaders(options) });
      }
    }
    // No way to renew the session: end it, so the portal shows the sign-in screen instead of an empty dashboard.
    clearSession();
    window.dispatchEvent(new CustomEvent('agripump:session-expired'));
  }
  return response;
}

/** JSON convenience wrapper: throws ApiError on non-2xx so callers can try/catch. */
export async function apiJson<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export { persistTokens, ApiError };
export function getAuthToken() {
  return authToken;
}
export function getRefreshToken() {
  return refreshTokenValue;
}
