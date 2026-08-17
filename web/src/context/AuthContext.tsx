import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { getStoredUser, hasSession } from '../api/client';
import { logout as apiLogout } from '../api/auth';
import type { User, AuthResult } from '../types';

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  mfaSetupRequired: boolean;
  setUser: (u: User) => void;
  handleAuthResult: (result: AuthResult) => void;
  clearMfaSetupRequired: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUserState] = useState<User | null>(() => (hasSession() ? getStoredUser() : null));
  const [mfaSetupRequired, setMfaSetupRequired] = useState(false);

  const setUser = useCallback((u: User) => setUserState(u), []);

  const handleAuthResult = useCallback((result: AuthResult) => {
    setUserState(result.user);
    setMfaSetupRequired(Boolean(result.mfa_setup_required));
  }, []);

  const clearMfaSetupRequired = useCallback(() => setMfaSetupRequired(false), []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUserState(null);
    setMfaSetupRequired(false);
  }, []);

  // A refresh failure anywhere in the app (apiFetch dispatches this) drops
  // the session the same way an explicit logout does.
  useEffect(() => {
    const onExpired = () => setUserState(null);
    window.addEventListener('agripump:session-expired', onExpired);
    return () => window.removeEventListener('agripump:session-expired', onExpired);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, isAuthenticated: Boolean(user), mfaSetupRequired, setUser, handleAuthResult, clearMfaSetupRequired, logout }}
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
