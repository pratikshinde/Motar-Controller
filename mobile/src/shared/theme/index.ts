/**
 * Design tokens for the customer app (planner P3.5).
 *
 * Audience: farmers, often outdoors in bright sun, often low-literacy.
 * Rules the tokens encode:
 *  - light, high-contrast surfaces (readable in sunlight; text >= WCAG AA on its background)
 *  - status is never colour alone: always colour + icon + word (see StatusPill)
 *  - big type and big touch targets (>= 56dp for anything that acts on a pump)
 *
 * The pump ON/OFF power button is deliberately NOT themed: it keeps its own
 * neon green / red on a dark surface (`power.*`) because farmers already know it.
 */
import { Platform } from 'react-native';
import { brand } from '@/config/brand';

export const baseColors = {
  // Surfaces
  bg: '#F4F7FB',
  surface: '#FFFFFF',
  surfaceAlt: '#F1F5F9',
  border: '#E8EDF5',
  borderStrong: '#CBD5E1',

  // Text
  text: '#0D1B2A',
  textMuted: '#475569',
  textFaint: '#596780',
  textOnDark: '#F2F8F0',
  textOnDarkMuted: '#9FB8A8',
  textOnPrimary: '#FFFFFF',

  // Brand
  primary: '#007F3B',
  primaryDark: '#006B32',
  primarySoft: '#E6F9F0',
  primaryBorder: '#BBF2D3',
  accent: '#FFB300', // sun / harvest amber
  accentSoft: '#FEF8E7',
  water: '#0088FF',
  waterSoft: '#EAF4FF',

  // Status (text-safe on light surfaces) + soft fills
  ok: '#007A30',
  okSoft: '#E6F9F0',
  warn: '#A15C00',
  warnSoft: '#FEF8E7',
  danger: '#C21840',
  dangerSoft: '#FFF0F3',
  idle: '#5B6B60',
  idleSoft: '#ECF0EA',
  purple: '#7C4DFF',
  purpleSoft: '#F3EAFF',

  // Phase colours (R / Y / B) - readable on white
  phaseR: '#FF3366',
  phaseY: '#FFB300',
  phaseB: '#0088FF',

  // Dark "hero" surface used behind the pump power button
  hero: '#0D2B20',
  heroBorder: '#1C4432',
  heroRaised: '#143A2B',
} as const;

/**
 * The palette the app really draws with: the tokens above, with the brand's own overrides on top (brands/<key>/brand.json,
 * `colors`). A brand that overrides nothing uses the base palette. `npm run a11y:contrast` checks every brand's result.
 */
export const colors: { [K in keyof typeof baseColors]: string } = { ...baseColors, ...(brand.colors as object) };

/** The pump power button. Kept exactly as farmers already know it. */
export const power = {
  on: '#00e676',
  off: '#ff1744',
  onFill: '#00e67620',
  offFill: '#ff174420',
} as const;

/** Card shadow used across the reference design's auth + dashboard screens. */
export const cardShadow = Platform.select({
  ios: { shadowColor: '#0D1B2A', shadowOpacity: 0.04, shadowRadius: 20, shadowOffset: { width: 0, height: 4 } },
  android: { elevation: 2 },
  default: { boxShadow: '0 4px 20px rgba(13, 27, 42, 0.04), 0 1px 3px rgba(13, 27, 42, 0.02)' } as any,
});

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

export const font = {
  caption: 13,
  body: 16,
  bodyLg: 18,
  title: 20,
  headline: 24,
  display: 30,
} as const;

/** Minimum touch size for anything that acts on a pump (planner P3.5: >= 56dp). */
export const TOUCH = 56;

export const shadow = Platform.select({
  ios: {
    shadowColor: '#0D2B20',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  android: { elevation: 3 },
  default: {
    // react-native-web
    boxShadow: '0 4px 14px rgba(13, 43, 32, 0.08)',
  } as any,
});

export const theme = { colors, power, space, radius, font, TOUCH, shadow, cardShadow };
export type Theme = typeof theme;
