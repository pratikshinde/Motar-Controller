import {
  apiFetch,
  persistTokens,
  clearSession,
  getStoredUser,
  hasSession,
  toAuthResult,
  getRefreshToken,
  messageFrom
} from './client';
import type { User, RoleTier, AuthResult, AccountStatus } from '../types';

export interface SendOtpOptions {
  isRegistration?: boolean;
  role?: RoleTier;
}

export interface VerifyOtpOptions {
  isRegistration?: boolean;
  role?: RoleTier;
  fullName?: string;
  organisationName?: string;
}

export interface SendOtpResponse {
  message: string;
  phone_number: string;
  dev_otp: string;
}

export interface AuthFlowState {
  phone: string;
  maskedPhone: string;
  role?: RoleTier;
  isRegistration?: boolean;
  tempToken?: string;
  challengeId?: string;
  userPreview?: Partial<User>;
}

// Pre-seeded client accounts for testing all SRS roles
const PRECONFIGURED_USERS: Record<string, { role: RoleTier; name: string; org: string; status: AccountStatus; mfa: boolean }> = {
  '9999900001': { role: 'superadmin', name: 'Keerthi (Super Admin)', org: 'AgriPump Platform Systems', status: 'ACTIVE', mfa: true },
  '9999900002': { role: 'manufacturer', name: 'Rajesh Sharma', org: 'Kisan Power Panels Ltd.', status: 'ACTIVE', mfa: false },
  '9999900003': { role: 'distributor', name: 'Anand Patel', org: 'Western Agri Equipments', status: 'ACTIVE', mfa: false },
  '9999900004': { role: 'dealer', name: 'Vijay Kumar', org: 'Kisan Seva Kendra', status: 'ACTIVE', mfa: false },
  '9999900005': { role: 'support', name: 'Vikram Singh', org: 'AgriPump Support Team', status: 'ACTIVE', mfa: false },
  '9999900006': { role: 'customer', name: 'Rameshwar Patil', org: 'Sangli Farm Unit #4', status: 'ACTIVE', mfa: false },
  '9999900999': { role: 'dealer', name: 'Suspended Account User', org: 'Pending Org', status: 'SUSPENDED', mfa: false }
};

// Registered in-memory / local storage user map
const REGISTERED_USERS_KEY = 'agripump_registered_users';

function getRegisteredUsers(): Record<string, { role: RoleTier; name: string; org: string; status: AccountStatus; mfa: boolean }> {
  try {
    const raw = localStorage.getItem(REGISTERED_USERS_KEY);
    return raw ? { ...PRECONFIGURED_USERS, ...JSON.parse(raw) } : { ...PRECONFIGURED_USERS };
  } catch {
    return { ...PRECONFIGURED_USERS };
  }
}

function saveRegisteredUser(phoneDigits: string, data: { role: RoleTier; name: string; org: string; status: AccountStatus; mfa: boolean }) {
  try {
    const current = getRegisteredUsers();
    current[phoneDigits] = data;
    localStorage.setItem(REGISTERED_USERS_KEY, JSON.stringify(current));
  } catch {
    // Ignore storage quota
  }
}

/** Format raw input to standard 10-digit number and E.164 string */
export function sanitizePhone(input: string): { rawDigits: string; e164: string; masked: string } {
  const digitsOnly = input.replace(/\D/g, '');
  const rawDigits = digitsOnly.length > 10 ? digitsOnly.slice(-10) : digitsOnly;
  const e164 = `+91${rawDigits}`;
  const masked = rawDigits.length >= 5
    ? `+91 •••••• ${rawDigits.slice(-5)}`
    : `+91 ${rawDigits}`;
  return { rawDigits, e164, masked };
}

/**
 * Authentication Service Abstraction
 * Fully integrated with FastAPI WhatsApp OTP & TOTP endpoints with safe mock dev fallback.
 */
class AuthService {
  private currentFlow: AuthFlowState = {
    phone: '',
    maskedPhone: ''
  };

  public setFlowState(state: Partial<AuthFlowState>) {
    this.currentFlow = { ...this.currentFlow, ...state };
  }

  public getFlowState(): AuthFlowState {
    return this.currentFlow;
  }

  public clearFlowState() {
    this.currentFlow = { phone: '', maskedPhone: '' };
  }

  /**
   * Send 6-digit OTP to user's WhatsApp number
   */
  public async sendWhatsAppOtp(phoneNumber: string, options?: SendOtpOptions): Promise<SendOtpResponse> {
    const { rawDigits, e164, masked } = sanitizePhone(phoneNumber);

    if (rawDigits.length !== 10) {
      throw new Error('Please enter a valid 10-digit mobile number.');
    }

    try {
      const endpoint = options?.isRegistration ? '/auth/register/request' : '/auth/otp/request';
      const payload = options?.isRegistration
        ? { phone: e164, role: options.role || 'dealer' }
        : { phone: e164 };

      const res = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (res.status >= 500) {
        throw new Error('SERVER_CONNECTION_ERROR');
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(messageFrom(data, 'Could not dispatch WhatsApp OTP.'));
      }

      this.setFlowState({
        phone: e164,
        maskedPhone: masked,
        isRegistration: Boolean(options?.isRegistration),
        role: options?.role
      });

      return {
        message: data.message || `OTP delivered to WhatsApp (${e164})`,
        phone_number: e164,
        dev_otp: data.dev_otp || '123456'
      };
    } catch (err: any) {
      // If server returned an explicit error response (4xx), rethrow to show user
      if (err.message && err.message !== 'SERVER_CONNECTION_ERROR' && !err.message.includes('Failed to fetch') && !err.message.includes('NetworkError')) {
        throw err;
      }

      // Offline / dev fallback
      const registered = getRegisteredUsers();
      const userRecord = registered[rawDigits];

      if (!options?.isRegistration && !userRecord) {
        throw new Error('No account found for this number. Please select Create Account or contact your administrator.');
      }

      if (userRecord && userRecord.status === 'SUSPENDED') {
        throw new Error('Your account is currently suspended. Please contact your organisation administrator.');
      }

      const devOtp = '123456';
      this.setFlowState({
        phone: e164,
        maskedPhone: masked,
        isRegistration: Boolean(options?.isRegistration),
        role: options?.role || userRecord?.role,
        userPreview: userRecord ? {
          full_name: userRecord.name,
          role: userRecord.role,
          contract_notes: userRecord.org
        } : undefined
      });

      return {
        message: `OTP delivered to WhatsApp (${e164})`,
        phone_number: e164,
        dev_otp: devOtp
      };
    }
  }

  /**
   * Verify WhatsApp OTP and establish session
   */
  public async verifyWhatsAppOtp(
    phoneNumber: string,
    otpCode: string,
    options?: VerifyOtpOptions
  ): Promise<{ requiresMfa: boolean; authResult?: AuthResult; tempToken?: string }> {
    const { rawDigits, e164, masked } = sanitizePhone(phoneNumber);
    const trimmedOtp = otpCode.trim();

    try {
      const endpoint = options?.isRegistration ? '/auth/register/verify' : '/auth/otp/verify';
      const payload = options?.isRegistration
        ? {
            phone: e164,
            otp: trimmedOtp,
            role: options.role,
            full_name: options.fullName,
            organisation_name: options.organisationName
          }
        : { phone: e164, otp: trimmedOtp };

      const res = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (res.status >= 500) {
        throw new Error('SERVER_CONNECTION_ERROR');
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(messageFrom(data, 'Incorrect OTP. Please try again.'));
      }

      // Check if Super Admin MFA is required
      if (data.status === 'MFA_REQUIRED' || data.requires_mfa || data.mfa_required) {
        const challengeId = data.challenge_id || data.temp_token;
        this.setFlowState({
          phone: e164,
          maskedPhone: masked,
          tempToken: challengeId,
          challengeId,
          role: 'superadmin'
        });
        return { requiresMfa: true, tempToken: challengeId };
      }

      const authResult = toAuthResult(data);
      if (authResult.token) {
        persistTokens(authResult);
        this.clearFlowState();
        return { requiresMfa: false, authResult };
      }

      throw new Error('Authentication succeeded but session could not be established.');
    } catch (err: any) {
      if (err.message && err.message !== 'SERVER_CONNECTION_ERROR' && !err.message.includes('Failed to fetch') && !err.message.includes('NetworkError')) {
        throw err;
      }

      // Dev mock fallback
      if (trimmedOtp !== '123456') {
        throw new Error('Incorrect OTP. Please try again.');
      }

      const registered = getRegisteredUsers();
      let userRecord = registered[rawDigits];

      if (options?.isRegistration && options.role) {
        const defaultOrg = options.role === 'customer'
          ? 'Irrigation Plot'
          : `${options.role.charAt(0).toUpperCase() + options.role.slice(1)} Unit`;

        userRecord = {
          role: options.role,
          name: options.fullName || `${options.role.toUpperCase()} User`,
          org: options.organisationName || defaultOrg,
          status: 'ACTIVE',
          mfa: options.role === 'superadmin'
        };

        saveRegisteredUser(rawDigits, userRecord);
      }

      if (!userRecord) {
        throw new Error('Account record could not be established. Please try again.');
      }

      if (userRecord.status === 'SUSPENDED') {
        throw new Error('Your account is currently suspended. Please contact your organisation administrator.');
      }

      if (userRecord.role === 'superadmin') {
        const tempToken = `mfa_temp_${rawDigits}_${Date.now()}`;
        this.setFlowState({ tempToken, challengeId: tempToken, role: 'superadmin' });
        return { requiresMfa: true, tempToken };
      }

      const user: User = {
        id: `usr_${rawDigits}`,
        full_name: userRecord.name,
        phone_number: e164,
        role: userRecord.role,
        hierarchy_path: `1.${userRecord.role}`,
        account_status: userRecord.status,
        contract_notes: userRecord.org
      };

      const authResult: AuthResult = {
        token: `token_${rawDigits}_${Date.now()}`,
        refreshToken: `refresh_${rawDigits}_${Date.now()}`,
        user,
        mfa_setup_required: false
      };

      persistTokens(authResult);
      this.clearFlowState();

      return { requiresMfa: false, authResult };
    }
  }

  /**
   * Super Admin Authenticator MFA Step (No Password!)
   */
  public async verifySuperAdminMfa(code: string): Promise<AuthResult> {
    const trimmedCode = code.trim();
    const flow = this.getFlowState();

    try {
      const challengeId = flow.challengeId || flow.tempToken || '';
      const res = await apiFetch('/auth/mfa/verify', {
        method: 'POST',
        body: JSON.stringify({
          challenge_id: challengeId,
          temp_token: challengeId,
          code: trimmedCode
        })
      });
      if (res.status >= 500) {
        throw new Error('SERVER_CONNECTION_ERROR');
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(messageFrom(data, 'Incorrect verification code. Please check your authenticator application.'));
      }

      const authResult = toAuthResult(data);
      if (authResult.token) {
        persistTokens(authResult);
        this.clearFlowState();
        return authResult;
      }
      throw new Error('MFA verified but session could not be established.');
    } catch (err: any) {
      if (err.message && err.message !== 'SERVER_CONNECTION_ERROR' && !err.message.includes('Failed to fetch') && !err.message.includes('NetworkError')) {
        throw err;
      }

      // Dev mock fallback
      if (trimmedCode !== '123456') {
        throw new Error('Incorrect verification code. Please check your authenticator application.');
      }

      const { rawDigits, e164 } = sanitizePhone(flow.phone || '9999900001');

      const user: User = {
        id: `usr_superadmin_${rawDigits}`,
        full_name: 'Platform Super Admin',
        phone_number: e164,
        role: 'superadmin',
        hierarchy_path: '1',
        account_status: 'ACTIVE',
        totp_enabled: true,
        contract_notes: 'AgriPump Platform Systems'
      };

      const authResult: AuthResult = {
        token: `token_superadmin_${Date.now()}`,
        refreshToken: `refresh_superadmin_${Date.now()}`,
        user,
        mfa_setup_required: false
      };

      persistTokens(authResult);
      this.clearFlowState();

      return authResult;
    }
  }

  /**
   * Enroll Super Admin MFA (TOTP QR code & provisioning secret)
   */
  public async enrollMfa(): Promise<{ secret: string; otpauth_url: string; qr_code: string }> {
    const flow = this.getFlowState();
    const challengeId = flow.challengeId || flow.tempToken;
    const res = await apiFetch('/auth/mfa/enroll', {
      method: 'POST',
      body: JSON.stringify(challengeId ? { challenge_id: challengeId, temp_token: challengeId } : {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(messageFrom(data, 'Failed to initialize MFA enrollment.'));
    }
    return data;
  }

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
    this.clearFlowState();
  }

  public async logoutAll(): Promise<void> {
    try {
      await apiFetch('/auth/logout-all', { method: 'POST' });
    } catch {
      // Best effort
    }
    clearSession();
    this.clearFlowState();
  }
}

export const authService = new AuthService();
