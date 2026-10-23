import { create } from 'zustand';
import {
  clearTokens,
  getAccessToken,
  getInstallId,
  getRefreshToken,
  loadTokens,
  onSessionExpired,
  setTokens,
} from '@/api/session';
import { clearCachedData } from '@/api/queryClient';
import { logout as logoutRequest, loginWithPassword } from '@/api/generated/farmer';
import type { UserOut } from '@/api/generated/model';
import { http } from '@/api/http';
import { storage } from '@/services/storage';

const USER_KEY = 'agripump_user';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

export interface SignInResult {
  user?: UserOut;
  mfaRequired?: boolean;
  tempToken?: string;
}

interface AuthState {
  status: AuthStatus;
  user: UserOut | null;
  /** True when the session ended on its own (refresh refused) rather than by tapping Logout. */
  expired: boolean;
  hydrate: () => Promise<void>;
  signIn: (phone: string, password: string) => Promise<SignInResult>;
  signInWithOtp: (phone: string, code: string) => Promise<SignInResult>;
  sendOtp: (phone: string) => Promise<{ message: string; dev_otp?: string }>;
  verifyMfa: (tempToken: string, code: string) => Promise<UserOut>;
  adoptUser: (user: UserOut) => Promise<void>;
  updateUser: (user: UserOut) => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,
  expired: false,

  async hydrate() {
    await loadTokens();
    const token = await getAccessToken();
    if (!token) {
      set({ status: 'signedOut', user: null });
      return;
    }
    let user: UserOut | null = null;
    try {
      const raw = await storage.getItem(USER_KEY);
      user = raw ? (JSON.parse(raw) as UserOut) : null;
    } catch {
      user = null;
    }
    set({ status: 'signedIn', user, expired: false });
  },

  async signIn(phone, password) {
    const res = await loginWithPassword({
      phone_number: phone,
      password,
      app_install_id: await getInstallId(),
      device_info: 'AgriPump app',
    });
    if (res.mfa_required || !res.access_token || !res.user) {
      if (res.mfa_required && res.temp_token) {
        return { mfaRequired: true, tempToken: res.temp_token, user: res.user ?? undefined };
      }
      throw Object.assign(new Error('MFA required'), {
        response: { status: 403, data: { error: { code: 'MFA_REQUIRED' } } },
      });
    }
    await setTokens(res.access_token, res.refresh_token!);
    await get().adoptUser(res.user);
    return { user: res.user, mfaRequired: false };
  },

  async sendOtp(phone: string) {
    const { data } = await http.post<{ message: string; dev_otp?: string }>('/auth/send-otp', {
      phone,
      phone_number: phone,
      channel: 'whatsapp',
    });
    return data;
  },

  async signInWithOtp(phone: string, code: string) {
    const { data } = await http.post<any>('/auth/verify-otp', {
      phone,
      phone_number: phone,
      code,
      otp: code,
      app_install_id: await getInstallId(),
      device_info: 'AgriPump app',
    });
    if (data.mfa_required || data.status === 'MFA_REQUIRED' || data.requires_mfa) {
      return {
        mfaRequired: true,
        tempToken: data.temp_token || data.challenge_id,
        user: data.user,
      };
    }
    if (!data.access_token || !data.user) {
      throw new Error(data.message || data.detail || 'OTP verification failed');
    }
    await setTokens(data.access_token, data.refresh_token);
    await get().adoptUser(data.user);
    return { user: data.user, mfaRequired: false };
  },

  async verifyMfa(tempToken: string, code: string) {
    const { data } = await http.post<any>('/auth/mfa/verify', {
      temp_token: tempToken,
      challenge_id: tempToken,
      code,
      totp_code: code,
      app_install_id: await getInstallId(),
      device_info: 'AgriPump app',
    });
    if (!data.access_token || !data.user) {
      throw new Error(data.message || data.detail || 'MFA verification failed');
    }
    await setTokens(data.access_token, data.refresh_token);
    await get().adoptUser(data.user);
    return data.user;
  },

  async adoptUser(user) {
    // Whatever was cached belongs to whoever was signed in before (a different person, on a shared
    // device, or the account this same person just created) - never let it flash under the new account.
    const previous = get().user;
    if (previous && previous.id !== user.id) await clearCachedData();
    await storage.setItem(USER_KEY, JSON.stringify(user));
    set({ status: 'signedIn', user, expired: false });
  },

  async updateUser(user) {
    await storage.setItem(USER_KEY, JSON.stringify(user));
    set({ user });
  },

  async signOut() {
    // Ends only THIS phone's session on the server; the farmer's other devices stay signed in.
    const refresh = await getRefreshToken();
    if (refresh) {
      try {
        await logoutRequest({ refresh_token: refresh });
      } catch {
        // Offline or already expired: the local sign-out below still happens.
      }
    }
    await clearTokens();
    await clearCachedData();
    set({ status: 'signedOut', user: null, expired: false });
  },
}));

onSessionExpired(() => {
  void clearCachedData();
  useAuth.setState({ status: 'signedOut', user: null, expired: true });
});
