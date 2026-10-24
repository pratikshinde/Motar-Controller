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

// Light scheme — Apple & Linear inspired clean workspace palette
export const lightRoles: M3ColorRoles = {
  primary: '#2563EB', // Technical Blue
  onPrimary: '#FFFFFF',
  primaryContainer: '#EFF6FF',
  onPrimaryContainer: '#1D4ED8',

  secondary: '#059669', // Healthy emerald
  onSecondary: '#FFFFFF',
  secondaryContainer: '#ECFDF5',
  onSecondaryContainer: '#047857',

  tertiary: '#D97706', // Warning amber
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#FFFBEB',
  onTertiaryContainer: '#B45309',

  error: '#DC2626', // Fault crimson
  onError: '#FFFFFF',
  errorContainer: '#FEF2F2',
  onErrorContainer: '#B91C1C',

  background: '#F8FAFC', // Slate 50 workspace background
  onBackground: '#0F172A', // Slate 900 primary text

  surface: '#FFFFFF',
  onSurface: '#0F172A',
  surfaceVariant: '#F1F5F9', // Slate 100
  onSurfaceVariant: '#475569', // Slate 600 secondary text
  surfaceContainerLowest: '#FFFFFF',
  surfaceContainerLow: '#F8FAFC',
  surfaceContainer: '#FFFFFF',
  surfaceContainerHigh: '#F1F5F9',
  surfaceContainerHighest: '#E2E8F0',

  outline: '#CBD5E1', // Slate 300
  outlineVariant: '#E2E8F0', // Slate 200 hairline border
  inverseSurface: '#0F172A',
  inverseOnSurface: '#F8FAFC',
  inversePrimary: '#93C5FD',
  scrim: '#000000',
  shadow: 'rgba(15, 23, 42, 0.08)'
};

// Dark scheme — Linear / macOS dark mode precision palette
export const darkRoles: M3ColorRoles = {
  primary: '#3B82F6', // Electric Blue
  onPrimary: '#FFFFFF',
  primaryContainer: '#1E3A8A',
  onPrimaryContainer: '#DBEAFE',

  secondary: '#10B981', // Clean Emerald
  onSecondary: '#FFFFFF',
  secondaryContainer: '#064E3B',
  onSecondaryContainer: '#A7F3D0',

  tertiary: '#F59E0B', // Crisp Amber
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#78350F',
  onTertiaryContainer: '#FEF3C7',

  error: '#EF4444',
  onError: '#FFFFFF',
  errorContainer: '#7F1D1D',
  onErrorContainer: '#FEE2E2',

  background: '#090D16', // Deep workspace canvas
  onBackground: '#F8FAFC',

  surface: '#0F172A', // Slate 900 cards & panels
  onSurface: '#F8FAFC',
  surfaceVariant: '#1E293B',
  onSurfaceVariant: '#94A3B8',
  surfaceContainerLowest: '#050811',
  surfaceContainerLow: '#0B1120',
  surfaceContainer: '#0F172A',
  surfaceContainerHigh: '#1E293B',
  surfaceContainerHighest: '#334155',

  outline: '#475569',
  outlineVariant: '#1E293B',
  inverseSurface: '#F8FAFC',
  inverseOnSurface: '#0F172A',
  inversePrimary: '#1E3A8A',
  scrim: '#000000',
  shadow: 'rgba(0, 0, 0, 0.4)'
};

// Refined application shape scale (corner radius, px)
export const shape = {
  none: 0,
  extraSmall: 4,
  small: 6,
  medium: 10,
  large: 14,
  extraLarge: 20,
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
