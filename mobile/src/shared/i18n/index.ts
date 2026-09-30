import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import { storage } from '@/services/storage';
import { getAccessToken } from '@/api/session';
import { updateMe } from '@/api/generated/farmer';
import { pseudoLocalize } from './pseudo';
import { DEFAULT_LANGUAGE, LangCode, isSupportedLanguage } from './languages';
import en from './locales/en.json';
import hi from './locales/hi.json';
import mr from './locales/mr.json';
import kn from './locales/kn.json';
import te from './locales/te.json';
import ta from './locales/ta.json';
import gu from './locales/gu.json';
import pa from './locales/pa.json';
import bn from './locales/bn.json';
import as_ from './locales/as.json';
import ne from './locales/ne.json';
import kok from './locales/kok.json';
import mai from './locales/mai.json';
import ks from './locales/ks.json';

export * from './languages';

const LOCALE_KEY = 'agripump_locale';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    hi: { translation: hi },
    mr: { translation: mr },
    kn: { translation: kn },
    te: { translation: te },
    ta: { translation: ta },
    gu: { translation: gu },
    pa: { translation: pa },
    bn: { translation: bn },
    as: { translation: as_ },
    ne: { translation: ne },
    kok: { translation: kok },
    mai: { translation: mai },
    ks: { translation: ks },
  },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
});

// EXPO_PUBLIC_PSEUDO_LOCALE=1 shows every string accented and stretched, to spot untranslated or clipped text.
if (process.env.EXPO_PUBLIC_PSEUDO_LOCALE === '1') {
  i18n.addResourceBundle('pseudo', 'translation', pseudoLocalize(en as never));
  void i18n.changeLanguage('pseudo');
}

export default i18n;

/** The language chosen on a previous launch, or null on the very first launch. */
export async function getSavedLanguage(): Promise<LangCode | null> {
  const saved = await storage.getItem(LOCALE_KEY);
  return isSupportedLanguage(saved) ? saved : null;
}

/** Best guess for the picker's preselection: the phone's language if we support it. */
export function getDeviceLanguage(): LangCode {
  try {
    const code = getLocales()[0]?.languageCode;
    if (isSupportedLanguage(code)) return code;
  } catch {
    // expo-localization unavailable - fall through to the default
  }
  return DEFAULT_LANGUAGE;
}

/** Switch the UI immediately without saving (used for the picker's live preview). */
export function previewLanguage(code: LangCode): Promise<unknown> {
  return i18n.changeLanguage(code);
}

/**
 * Switch the UI, remember it on this phone, and tell the server so push / SMS /
 * voice replies use the same language. The server call is best-effort: being
 * offline or logged out must never block the farmer from changing language.
 */
export async function setAppLanguage(code: LangCode): Promise<void> {
  await i18n.changeLanguage(code);
  await storage.setItem(LOCALE_KEY, code);
  await syncLanguageToServer(code);
}

export async function syncLanguageToServer(code: LangCode): Promise<void> {
  try {
    if (!(await getAccessToken())) return;
    await updateMe({ locale: code });
  } catch {
    // Retried on the next login / language change.
  }
}
