import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { getStoredUser, hasSession, apiFetch, toAuthResult, persistTokens, getRefreshToken } from '../api/client';
import { authService } from '../api/authService';
import type { User, RoleTier, AuthResult } from '../types';

export interface AuthContextValue {
  user: User | null;
  role: RoleTier | null;
  organisation: string | null;
  permissions: string[];
  isAuthenticated: boolean;
  isMfaRequired: boolean;
  mfaSetupRequired: boolean;
  login: (phoneNumber: string) => Promise<any>;
  requestOtp: (phoneNumber: string, isRegistration?: boolean, role?: RoleTier) => Promise<any>;
  verifyOtp: (phoneNumber: string, otpCode: string, options?: any) => Promise<any>;
  verifyMfa: (code: string) => Promise<any>;
  register: (phoneNumber: string, role: RoleTier, fullName?: string, orgName?: string) => Promise<any>;
  setUser: (u: User) => void;
  handleAuthResult: (result: AuthResult) => void;
  clearMfaSetupRequired: () => void;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  refreshSession: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function getRolePermissions(role?: RoleTier | null): string[] {
  if (!role) return [];
  switch (role) {
    case 'superadmin':
      return ['*'];
    case 'manufacturer':
      return [
        'VIEW_DEVICES',
        'CONTROL_DEVICE',
        'COMMISSION_DEVICE',
        'CREATE_DISTRIBUTOR',
        'VIEW_FLEET',
        'MANAGE_FIRMWARE',
        'VIEW_AUDIT'
      ];
    case 'distributor':
      return [
        'VIEW_DEVICES',
        'CONTROL_DEVICE',
        'CREATE_DEALER',
        'VIEW_FLEET'
      ];
    case 'dealer':
      return [
        'VIEW_DEVICES',
        'CONTROL_DEVICE',
        'CREATE_DEALER',
        'INVITE_END_USER',
        'BIND_PANEL'
      ];
    case 'support':
      return [
        'VIEW_DEVICES',
        'CONTROL_DEVICE',
        'ACK_ALERT',
        'DIAGNOSTICS'
      ];
    case 'customer':
      return [
        'VIEW_DEVICES',
        'CONTROL_DEVICE'
      ];
    default:
      return [];
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUserState] = useState<User | null>(() => (hasSession() ? getStoredUser() : null));
  const [mfaSetupRequired, setMfaSetupRequired] = useState(false);
  const [isMfaRequired, setIsMfaRequired] = useState(false);

  const role = useMemo<RoleTier | null>(() => user?.role ?? null, [user]);
  const organisation = useMemo<string | null>(() => user?.contract_notes ?? null, [user]);
  const permissions = useMemo<string[]>(() => getRolePermissions(role), [role]);

  const setUser = useCallback((u: User) => setUserState(u), []);

  const handleAuthResult = useCallback((result: AuthResult) => {
    setUserState(result.user);
    setMfaSetupRequired(Boolean(result.mfa_setup_required));
    setIsMfaRequired(false);
  }, []);

  const clearMfaSetupRequired = useCallback(() => setMfaSetupRequired(false), []);

  const login = useCallback(async (phoneNumber: string) => {
    return authService.sendWhatsAppOtp(phoneNumber);
  }, []);

  const requestOtp = useCallback(async (phoneNumber: string, isRegistration?: boolean, roleTier?: RoleTier) => {
    return authService.sendWhatsAppOtp(phoneNumber, { isRegistration, role: roleTier });
  }, []);

  const verifyOtp = useCallback(async (phoneNumber: string, otpCode: string, options?: any) => {
    const outcome = await authService.verifyWhatsAppOtp(phoneNumber, otpCode, options);
    if (outcome.requiresMfa) {
      setIsMfaRequired(true);
    } else if (outcome.authResult) {
      handleAuthResult(outcome.authResult);
    }
    return outcome;
  }, [handleAuthResult]);

  const verifyMfa = useCallback(async (code: string) => {
    const result = await authService.verifySuperAdminMfa(code);
    handleAuthResult(result);
    return result;
  }, [handleAuthResult]);

  const register = useCallback(async (phoneNumber: string, roleTier: RoleTier, fullName?: string, orgName?: string) => {
    return authService.sendWhatsAppOtp(phoneNumber, { isRegistration: true, role: roleTier });
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
    setUserState(null);
    setMfaSetupRequired(false);
    setIsMfaRequired(false);
  }, []);

  const logoutAll = useCallback(async () => {
    await authService.logoutAll();
    setUserState(null);
    setMfaSetupRequired(false);
    setIsMfaRequired(false);
  }, []);

  const refreshSession = useCallback(async (): Promise<boolean> => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) return false;
    try {
      const res = await apiFetch('/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken })
      });
      if (!res.ok) return false;
      const data = await res.json();
      const result = toAuthResult(data);
      if (result.token) {
        persistTokens(result);
        if (result.user) setUserState(result.user);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    const onExpired = () => {
      setUserState(null);
      setIsMfaRequired(false);
    };
    const onMfaSetup = () => setMfaSetupRequired(true);
    window.addEventListener('agripump:session-expired', onExpired);
    window.addEventListener('agripump:mfa-setup-required', onMfaSetup);
    return () => {
      window.removeEventListener('agripump:session-expired', onExpired);
      window.removeEventListener('agripump:mfa-setup-required', onMfaSetup);
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        organisation,
        permissions,
        isAuthenticated: Boolean(user),
        isMfaRequired,
        mfaSetupRequired,
        login,
        requestOtp,
        verifyOtp,
        verifyMfa,
        register,
        setUser,
        handleAuthResult,
        clearMfaSetupRequired,
        logout,
        logoutAll,
        refreshSession
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
