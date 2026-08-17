import React, { createContext, useContext, useMemo, useState, useCallback, useEffect } from 'react';
import { ThemeProvider, type PaletteMode } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { buildAppTheme } from './index';
import { paletteFromSeed } from './dynamicPalette';
import { getBrandingSeed, subscribeBrandingSeed } from './brandingStore';

const STORAGE_KEY = 'agripump_theme';

// The pre-redesign build stored three decorative preset names
// (sapphire / agro-light / cyber-neon). Strict M3 compliance means light
// and dark derived from one seed, not a third bespoke theme — see
// Web_App_Pending_Items.md §11.1. Only 'agro-light' maps forward to
// light; every other legacy value (including 'cyber-neon', which could
// not meet M3 contrast) defaults to dark.
function readInitialMode(): PaletteMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'agro-light') return 'light';
  if (stored === 'dark') return 'dark';
  if (stored === 'sapphire' || stored === 'cyber-neon') return 'dark';
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

interface ColorModeContextValue {
  mode: PaletteMode;
  toggleMode: () => void;
  setMode: (m: PaletteMode) => void;
}

const ColorModeContext = createContext<ColorModeContextValue | null>(null);

export const AppThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<PaletteMode>(readInitialMode);
  // Mirrors the brandingStore module variable into React state so a
  // resolved (or cleared, e.g. on logout) partner seed re-renders the
  // theme — see theme/brandingStore.ts for why this lives outside a
  // normal context.
  const [seed, setSeed] = useState<string | null>(getBrandingSeed);

  useEffect(() => subscribeBrandingSeed(() => setSeed(getBrandingSeed())), []);

  const setMode = useCallback((m: PaletteMode) => {
    setModeState(m);
    localStorage.setItem(STORAGE_KEY, m);
  }, []);

  const toggleMode = useCallback(() => {
    setModeState(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const brandRoles = useMemo(() => (seed ? paletteFromSeed(seed)[mode] : undefined), [seed, mode]);
  const theme = useMemo(() => buildAppTheme(mode, brandRoles), [mode, brandRoles]);

  return (
    <ColorModeContext.Provider value={{ mode, toggleMode, setMode }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
};

export function useColorMode() {
  const ctx = useContext(ColorModeContext);
  if (!ctx) throw new Error('useColorMode must be used within AppThemeProvider');
  return ctx;
}
