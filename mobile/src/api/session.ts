import { storage } from '@/services/storage';

const TOKEN_KEY = 'agripump_token';
const REFRESH_KEY = 'agripump_refresh';
const INSTALL_KEY = 'agripump_install_id';

let accessToken: string | null = null;
let refreshToken: string | null = null;
let loaded = false;
const expiredListeners = new Set<() => void>();

function randomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** A fresh random id, used for Idempotency-Key headers. */
export const newRequestId = randomId;

export async function loadTokens(): Promise<void> {
  if (loaded) return;
  accessToken = await storage.getItem(TOKEN_KEY);
  refreshToken = await storage.getItem(REFRESH_KEY);
  loaded = true;
}

export async function getAccessToken(): Promise<string | null> {
  await loadTokens();
  return accessToken;
}

export async function getRefreshToken(): Promise<string | null> {
  await loadTokens();
  return refreshToken;
}

export async function setTokens(access: string, refresh?: string | null): Promise<void> {
  accessToken = access;
  loaded = true;
  await storage.setItem(TOKEN_KEY, access);
  if (refresh) {
    refreshToken = refresh;
    await storage.setItem(REFRESH_KEY, refresh);
  }
}

export async function clearTokens(): Promise<void> {
  accessToken = null;
  refreshToken = null;
  loaded = true;
  await storage.clearAuth();
}

/** Stable per installation; lets the server bind a refresh token to this phone. */
export async function getInstallId(): Promise<string> {
  let id = await storage.getItem(INSTALL_KEY);
  if (!id) {
    id = randomId();
    await storage.setItem(INSTALL_KEY, id);
  }
  return id;
}

/** Called when a refresh fails and the person must log in again. */
export function onSessionExpired(cb: () => void): () => void {
  expiredListeners.add(cb);
  return () => expiredListeners.delete(cb);
}

export function notifySessionExpired(): void {
  expiredListeners.forEach((cb) => cb());
}
