import Constants from 'expo-constants';
import { Platform } from 'react-native';
import ajanta from '../../brands/ajanta/brand.json';

/**
 * Whose app this is. One codebase is built once per manufacturer; the build (BRAND=<key>, see app.config.js and
 * brands/README.md) decides the brand and hands its public half to the app through `extra`. Anything that names the
 * manufacturer - the splash and sign-in header, the account-created message, the colours - reads it from here, never
 * from a literal.
 */
export interface Brand {
  /** Short machine name, also sent to the server on every request (X-App-Brand). */
  key: string;
  /** Full product name, e.g. "Swati Pump Controller". */
  appName: string;
  /** The mark in the small header, e.g. "SWATI". */
  shortName: string;
  titleLine1: string;
  titleLine2: string;
  tagline?: string;
  /** Which screen design this brand's app uses: the original one ('classic') or Swati's ('swati'). */
  design?: 'classic' | 'swati';
  /** Overrides for the design tokens in shared/theme (same names, #RRGGBB). */
  colors: Record<string, string>;
}

type PublicBrand = Partial<Brand>;

type BuildConfig = { extra?: { brand?: PublicBrand } } | null | undefined;

/**
 * The build's config. On the web `Constants.expoConfig` can hold the first brand's config instead of this build's (and it
 * cannot read the inlined JSON string), so the web build reads the copy Metro inlined into this bundle; the phone's
 * build reads Constants as before.
 */
function readBuildConfig(): BuildConfig {
  const decode = (raw: unknown): BuildConfig => (typeof raw === 'string' ? JSON.parse(raw) : raw) as BuildConfig;
  if (Platform.OS === 'web') {
    try {
      const inlined = decode(process.env.APP_MANIFEST);
      if (inlined?.extra?.brand) return inlined;
    } catch {
      // fall through to Constants
    }
  }
  try {
    return decode(Constants.expoConfig);
  } catch {
    return undefined;
  }
}

const fromBuild = readBuildConfig()?.extra?.brand;

// A build that carries no brand (jest, an old dev client) is the first brand, which is also what an unconfigured
// `expo start` builds. (Only the public fields: the folder's build-only half never reaches the app.)
const defaults: Brand = {
  key: ajanta.key,
  appName: ajanta.appName,
  shortName: ajanta.shortName,
  titleLine1: ajanta.titleLine1,
  titleLine2: ajanta.titleLine2,
  design: 'classic',
  colors: ajanta.colors as Record<string, string>,
};

export const brand: Brand = {
  ...defaults,
  ...fromBuild,
  colors: { ...defaults.colors, ...(fromBuild?.colors ?? {}) },
};
