/**
 * App languages. Each is shown in its own script on the picker so a farmer who
 * can't read English can still find it.
 *
 * Adding a language = add an entry here + a locales/<code>.json file + import it
 * in ./index.ts (`npm run i18n:check` fails until every key exists).
 */
export type LangCode =
  | 'en'
  | 'hi'
  | 'mr'
  | 'kn' // planner Tier A
  | 'te'
  | 'ta'
  | 'gu'
  | 'pa'
  | 'bn'
  | 'as'
  | 'ne'
  | 'kok'
  | 'mai'
  | 'ks';

/**
 * How reliable the wording is. EVERY language still needs a native-speaker
 * review before release (planner P3.6); this only says where to look first.
 */
export type TranslationConfidence = 'good' | 'fair' | 'weak';

export interface LanguageInfo {
  code: LangCode;
  /** Name in its own script - what the farmer looks for. */
  native: string;
  /** Name in English - for dealers / support staff and screen readers. */
  english: string;
  /**
   * Device text-to-speech voices to try, best first. Devanagari languages without
   * their own voice fall back to Hindi; Kashmiri to Urdu (same script family).
   */
  speech: string[];
  /** Right-to-left script (Kashmiri is written in Perso-Arabic). */
  rtl?: boolean;
  confidence: TranslationConfidence;
}

// Order = order on the picker: the four launch languages first, then the rest by reach.
export const LANGUAGES: LanguageInfo[] = [
  { code: 'en', native: 'English', english: 'English', speech: ['en-IN', 'en-US', 'en-GB'], confidence: 'good' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi', speech: ['hi-IN'], confidence: 'good' },
  { code: 'mr', native: 'मराठी', english: 'Marathi', speech: ['mr-IN'], confidence: 'good' },
  { code: 'kn', native: 'ಕನ್ನಡ', english: 'Kannada', speech: ['kn-IN'], confidence: 'fair' },
  { code: 'te', native: 'తెలుగు', english: 'Telugu', speech: ['te-IN'], confidence: 'good' },
  { code: 'ta', native: 'தமிழ்', english: 'Tamil', speech: ['ta-IN'], confidence: 'good' },
  { code: 'gu', native: 'ગુજરાતી', english: 'Gujarati', speech: ['gu-IN'], confidence: 'good' },
  { code: 'pa', native: 'ਪੰਜਾਬੀ', english: 'Punjabi', speech: ['pa-IN'], confidence: 'good' },
  { code: 'bn', native: 'বাংলা', english: 'Bengali', speech: ['bn-IN', 'bn-BD'], confidence: 'good' },
  { code: 'as', native: 'অসমীয়া', english: 'Assamese', speech: ['as-IN', 'bn-IN'], confidence: 'fair' },
  { code: 'ne', native: 'नेपाली', english: 'Nepali', speech: ['ne-NP', 'ne-IN', 'hi-IN'], confidence: 'fair' },
  { code: 'kok', native: 'कोंकणी', english: 'Konkani', speech: ['kok-IN', 'mr-IN', 'hi-IN'], confidence: 'weak' },
  { code: 'mai', native: 'मैथिली', english: 'Maithili', speech: ['mai-IN', 'hi-IN'], confidence: 'weak' },
  {
    code: 'ks',
    native: 'کٲشُر',
    english: 'Kashmiri',
    speech: ['ks-IN', 'ur-IN', 'ur-PK'],
    rtl: true,
    confidence: 'weak',
  },
];

export const DEFAULT_LANGUAGE: LangCode = 'en';

export const isSupportedLanguage = (code: unknown): code is LangCode =>
  typeof code === 'string' && LANGUAGES.some((l) => l.code === code);

export const languageInfo = (code: string): LanguageInfo => LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];

/** True for right-to-left scripts (currently only Kashmiri). */
export const isRtl = (code: string): boolean => !!LANGUAGES.find((l) => l.code === code)?.rtl;

/**
 * Intl locale for dates and times. `-u-nu-latn` forces Western digits: Marathi's
 * and Nepali's default is Devanagari digits, Bengali's is Bengali digits - all of
 * which would sit oddly beside the 412.5 V readings. Engines without data for a
 * locale (Konkani, Maithili on some phones) fall back to the default automatically.
 */
export const intlLocale = (code: string): string => `${INTL_FALLBACK[code] ?? code}-IN-u-nu-latn`;

/**
 * Konkani, Maithili and Kashmiri have no date/time data on most phones, so dates
 * would silently come out in English. Use the nearest language that does: the
 * scripts match (Devanagari for the first two, Perso-Arabic for Kashmiri).
 */
const INTL_FALLBACK: Record<string, string> = { kok: 'mr', mai: 'hi', ks: 'ur', pseudo: 'en' };

/**
 * Indic and Arabic-script text joins letters; CSS/RN letter-spacing pulls them
 * apart. Use `tracking(lang, n)` instead of a raw letterSpacing on translated text.
 */
export const tracking = (code: string, spacing: number): { letterSpacing: number } => ({
  letterSpacing: code === 'en' ? spacing : 0,
});
