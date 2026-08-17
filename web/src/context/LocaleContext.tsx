import React, { createContext, useContext, useState, useCallback } from 'react';
import { dictionaries, supportedLocales, type SupportedLocale, type Dict } from '../i18n';

const STORAGE_KEY = 'agripump_lang';

function readInitialLocale(): SupportedLocale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && (supportedLocales as readonly string[]).includes(stored)) return stored as SupportedLocale;
  return 'en';
}

interface LocaleContextValue {
  locale: SupportedLocale;
  t: Dict;
  setLocale: (l: SupportedLocale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export const LocaleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<SupportedLocale>(readInitialLocale);

  const setLocale = useCallback((l: SupportedLocale) => {
    setLocaleState(l);
    localStorage.setItem(STORAGE_KEY, l);
  }, []);

  return (
    <LocaleContext.Provider value={{ locale, t: dictionaries[locale], setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
};

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider');
  return ctx;
}
