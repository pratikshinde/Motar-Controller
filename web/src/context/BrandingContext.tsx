import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { fetchResolvedBranding } from '../api/branding';
import { setBrandingSeed } from '../theme/brandingStore';
import { useAuth } from './AuthContext';
import type { BrandingConfig } from '../types';

interface BrandingContextValue {
  branding: BrandingConfig | null;
  refresh: () => void;
}

const BrandingContext = createContext<BrandingContextValue | null>(null);

// FR-WEB-036 — resolves once per login (and on demand after a settings
// save) rather than on every navigation; branding changes rarely enough
// that a manual refresh() after saving is simpler and cheaper than
// re-resolving on every route change.
export const BrandingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [branding, setBrandingState] = useState<BrandingConfig | null>(null);

  const load = useCallback(async () => {
    if (!isAuthenticated) {
      setBrandingState(null);
      setBrandingSeed(null);
      return;
    }
    try {
      const { branding: resolved } = await fetchResolvedBranding();
      setBrandingState(resolved);
      setBrandingSeed(resolved?.primary_color || null);
    } catch {
      // A failed resolve falls back to the default theme rather than
      // blocking the app — branding is cosmetic, never load-bearing.
      setBrandingState(null);
      setBrandingSeed(null);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    load();
  }, [load]);

  return <BrandingContext.Provider value={{ branding, refresh: load }}>{children}</BrandingContext.Provider>;
};

export function useBranding() {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error('useBranding must be used within BrandingProvider');
  return ctx;
}
