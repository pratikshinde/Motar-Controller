/**
 * Material Design 3 tokens for AgriPump SmartSpace.
 *
 * Seed: a technical blue (control/telemetry) paired with an agricultural
 * green (running/healthy state) as the secondary role — both roles are
 * carried through the full M3 container/on-container pairing, not just
 * a single accent color per role, per Web_App_Pending_Items.md §11.1.
 */

export interface M3ColorRoles {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;

  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;

  tertiary: string;
  onTertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;

  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;

  background: string;
  onBackground: string;

  surface: string;
  onSurface: string;
  surfaceVariant: string;
  onSurfaceVariant: string;
  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;

  outline: string;
  outlineVariant: string;
  inverseSurface: string;
  inverseOnSurface: string;
  inversePrimary: string;
  scrim: string;
  shadow: string;
}

// Light scheme — derived from seed #0B5FA5 (primary) / #386A20 (secondary,
// agri green) / #7A5900 (tertiary, amber for warnings/fault accents).
export const lightRoles: M3ColorRoles = {
  primary: '#2563EB', // Vibrant Blue
  onPrimary: '#FFFFFF',
  primaryContainer: '#DBEAFE',
  onPrimaryContainer: '#1E3A8A',

  secondary: '#059669', // Vibrant Emerald
  onSecondary: '#FFFFFF',
  secondaryContainer: '#D1FAE5',
  onSecondaryContainer: '#064E3B',

  tertiary: '#D97706', // Vibrant Amber
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#FEF3C7',
  onTertiaryContainer: '#78350F',

  error: '#DC2626',
  onError: '#FFFFFF',
  errorContainer: '#FEE2E2',
  onErrorContainer: '#7F1D1D',

  background: '#F8FAFC', // Slate 50
  onBackground: '#0F172A', // Slate 900

  surface: '#FFFFFF',
  onSurface: '#0F172A',
  surfaceVariant: '#E2E8F0',
  onSurfaceVariant: '#475569',
  surfaceContainerLowest: '#FFFFFF',
  surfaceContainerLow: '#F8FAFC',
  surfaceContainer: '#F1F5F9',
  surfaceContainerHigh: '#E2E8F0',
  surfaceContainerHighest: '#CBD5E1',

  outline: '#94A3B8',
  outlineVariant: '#CBD5E1',
  inverseSurface: '#1E293B',
  inverseOnSurface: '#F8FAFC',
  inversePrimary: '#93C5FD',
  scrim: '#000000',
  shadow: '#000000'
};

// Dark scheme — same seed, tonal roles inverted per M3 dark-theme rules.
export const darkRoles: M3ColorRoles = {
  primary: '#3B82F6', // Electric Blue
  onPrimary: '#FFFFFF',
  primaryContainer: '#1E3A8A',
  onPrimaryContainer: '#DBEAFE',

  secondary: '#10B981', // Neon Emerald
  onSecondary: '#FFFFFF',
  secondaryContainer: '#064E3B',
  onSecondaryContainer: '#D1FAE5',

  tertiary: '#F59E0B', // Glowing Amber
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#78350F',
  onTertiaryContainer: '#FEF3C7',

  error: '#EF4444',
  onError: '#FFFFFF',
  errorContainer: '#7F1D1D',
  onErrorContainer: '#FEE2E2',

  background: '#09090B', // Deepest Zinc
  onBackground: '#FAFAFA',

  surface: '#0F172A', // Deep Slate
  onSurface: '#F8FAFC',
  surfaceVariant: '#334155',
  onSurfaceVariant: '#CBD5E1',
  surfaceContainerLowest: '#020617',
  surfaceContainerLow: '#0F172A',
  surfaceContainer: '#1E293B',
  surfaceContainerHigh: '#334155',
  surfaceContainerHighest: '#475569',

  outline: '#64748B',
  outlineVariant: '#334155',
  inverseSurface: '#F8FAFC',
  inverseOnSurface: '#0F172A',
  inversePrimary: '#1E3A8A',
  scrim: '#000000',
  shadow: '#000000'
};

// M3 shape scale (corner radius, px)
export const shape = {
  none: 0,
  extraSmall: 4,
  small: 8,
  medium: 12,
  large: 16,
  extraLarge: 28,
  full: 999
};

// M3 elevation levels expressed as surface-tint overlay opacity (applied as
// a primary-tinted wash over surfaceContainer, per the M3 tonal-elevation
// spec) plus a matching soft shadow — not just a darker box-shadow.
export const elevationTintOpacity = [0, 0.05, 0.08, 0.11, 0.12, 0.14];

// Status colors kept distinct from the M3 semantic roles: these map to
// pump run-state, not to UI feedback severity, so they get their own
// tokens rather than overloading error/tertiary.
export const statusColors = {
  running: { light: '#2E7D32', dark: '#7DD990' },
  stopped: { light: '#5F6368', dark: '#9AA0A6' },
  fault: { light: '#BA1A1A', dark: '#FFB4AB' }
};
