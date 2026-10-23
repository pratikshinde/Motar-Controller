import { apiFetch, clearSession, getStoredUser, hasSession, getRefreshToken } from './client';
import type { User } from '../types';

/**
 * Ending a portal session. Signing in lives elsewhere and always talks to the real backend: a password or SMS code in
 * `api/auth.ts`, the authenticator step in `api/mfa.ts`, an invite link in `api/invites.ts`.
 *
 * An earlier version of this file also carried an offline fallback that answered "123456" and minted a local session
 * (superadmin included) whenever the server was unreachable. It is gone on purpose: a sign-in that works without the
 * server is not a sign-in.
 */
class AuthService {
  public getCurrentUser(): User | null {
    return getStoredUser();
  }

  public hasActiveSession(): boolean {
    return hasSession();
  }

  public async logout(): Promise<void> {
    try {
      const refreshToken = getRefreshToken();
      if (refreshToken) {
        await apiFetch('/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refresh_token: refreshToken })
        });
      }
    } catch {
      // Best effort server-side revocation
    }
    clearSession();
  }

  public async logoutAll(): Promise<void> {
    try {
      await apiFetch('/auth/logout-all', { method: 'POST' });
    } catch {
      // Best effort
    }
    clearSession();
  }
}

export const authService = new AuthService();
