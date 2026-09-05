// Ported from web/index.html's apiFetch/persistTokens (auth flow hardened
// in the 17 Aug security pass — see web/ARCHITECTURE_DECISION.md). This is
// the reference implementation of the API contract; behaviour is preserved
// exactly, only the transport (fetch → typed client) changed.
import type { AuthResult } from '../types';

export const API_BASE = '/api';

const TOKEN_KEY = 'agripump_token';
const REFRESH_KEY = 'agripump_refresh';
const USER_KEY = 'agripump_user';

let authToken = localStorage.getItem(TOKEN_KEY) || '';
let refreshTokenValue = localStorage.getItem(REFRESH_KEY) || '';

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
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  return headers;
}

let refreshInFlight: Promise<AuthResult | null> | null = null;

class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    super(body?.error || body?.message || `Request failed (${status})`);
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
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const mergedHeaders = { ...authHeaders(), ...(options.headers as Record<string, string> | undefined) };
  let response = await fetch(url, { ...options, headers: mergedHeaders });

  if ((response.status === 401 || response.status === 403) && refreshTokenValue) {
    if (!refreshInFlight) {
      refreshInFlight = fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refreshTokenValue })
      })
        .then(async r => (r.ok ? ((await r.json()) as AuthResult) : null))
        .finally(() => {
          refreshInFlight = null;
        });
    }
    const refreshed = await refreshInFlight;
    if (refreshed && refreshed.token) {
      persistTokens(refreshed);
      const retryHeaders = { ...authHeaders(), ...(options.headers as Record<string, string> | undefined) };
      response = await fetch(url, { ...options, headers: retryHeaders });
    } else {
      clearSession();
      window.dispatchEvent(new CustomEvent('agripump:session-expired'));
    }
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
