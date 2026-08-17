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
  primary: '#0B5FA5',
  onPrimary: '#FFFFFF',
  primaryContainer: '#D3E4FF',
  onPrimaryContainer: '#001C38',

  secondary: '#3C6A2C',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#BCF0A2',
  onSecondaryContainer: '#062100',

  tertiary: '#8C5000',
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#FFDDB6',
  onTertiaryContainer: '#2C1600',

  error: '#BA1A1A',
  onError: '#FFFFFF',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#410002',

  background: '#F8F9FF',
  onBackground: '#191C20',

  surface: '#F8F9FF',
  onSurface: '#191C20',
  surfaceVariant: '#DFE2EB',
  onSurfaceVariant: '#43474E',
  surfaceContainerLowest: '#FFFFFF',
  surfaceContainerLow: '#F2F3FA',
  surfaceContainer: '#ECEDF4',
  surfaceContainerHigh: '#E6E8EF',
  surfaceContainerHighest: '#E1E2E9',

  outline: '#73777F',
  outlineVariant: '#C3C6CF',
  inverseSurface: '#2E3135',
  inverseOnSurface: '#EFF0F7',
  inversePrimary: '#A5C8FF',
  scrim: '#000000',
  shadow: '#000000'
};

// Dark scheme — same seed, tonal roles inverted per M3 dark-theme rules.
export const darkRoles: M3ColorRoles = {
  primary: '#A5C8FF',
  onPrimary: '#00315E',
  primaryContainer: '#004884',
  onPrimaryContainer: '#D3E4FF',

  secondary: '#A1D386',
  onSecondary: '#0F3900',
  secondaryContainer: '#245113',
  onSecondaryContainer: '#BCF0A2',

  tertiary: '#FFB876',
  onTertiary: '#4A2800',
  tertiaryContainer: '#6A3B00',
  onTertiaryContainer: '#FFDDB6',

  error: '#FFB4AB',
  onError: '#690005',
  errorContainer: '#93000A',
  onErrorContainer: '#FFDAD6',

  background: '#111318',
  onBackground: '#E2E2E9',

  surface: '#111318',
  onSurface: '#E2E2E9',
  surfaceVariant: '#43474E',
  onSurfaceVariant: '#C3C6CF',
  surfaceContainerLowest: '#0B0E13',
  surfaceContainerLow: '#191C20',
  surfaceContainer: '#1D2024',
  surfaceContainerHigh: '#282A2F',
  surfaceContainerHighest: '#33353A',

  outline: '#8D9199',
  outlineVariant: '#43474E',
  inverseSurface: '#E2E2E9',
  inverseOnSurface: '#2E3135',
  inversePrimary: '#0B5FA5',
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
