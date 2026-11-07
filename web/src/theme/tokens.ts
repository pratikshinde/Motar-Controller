/**
 * Material Design 3 tokens for AgriPump SmartSpace.
 *
 * Ajanta palette (the same three colours as the farmer's app): deep green (the land) as the primary, water blue (the pump,
 * live data) as the secondary, sun amber for warnings. "Running" is its own success green (see statusColors). Earlier note: a technical blue paired with an agricultural
 * green as the secondary role — both roles are
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
  primary: '#0B7A3E', // Technical Blue
  onPrimary: '#FFFFFF',
  primaryContainer: '#E4F5EA',
  onPrimaryContainer: '#064B27',

  secondary: '#0B7FC7', // Healthy emerald
  onSecondary: '#FFFFFF',
  secondaryContainer: '#E3F2FB',
  onSecondaryContainer: '#075A8F',

  tertiary: '#C77700', // Warning amber
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#FFF4DB',
  onTertiaryContainer: '#8A5200',

  error: '#DC2626', // Fault crimson
  onError: '#FFFFFF',
  errorContainer: '#FEF2F2',
  onErrorContainer: '#B91C1C',

  background: '#F5F9F6', // Slate 50 workspace background
  onBackground: '#0F1A14', // Slate 900 primary text

  surface: '#FFFFFF',
  onSurface: '#0F1A14',
  surfaceVariant: '#ECF3EE', // Slate 100
  onSurfaceVariant: '#46594E', // Slate 600 secondary text
  surfaceContainerLowest: '#FFFFFF',
  surfaceContainerLow: '#F5F9F6',
  surfaceContainer: '#FFFFFF',
  surfaceContainerHigh: '#ECF3EE',
  surfaceContainerHighest: '#DFE9E3',

  outline: '#C3D0C8', // Slate 300
  outlineVariant: '#DFE9E3', // Slate 200 hairline border
  inverseSurface: '#0F1A14',
  inverseOnSurface: '#F5F9F6',
  inversePrimary: '#7FD7A2',
  scrim: '#000000',
  shadow: 'rgba(15, 26, 20, 0.08)'
};

// Dark scheme — Linear / macOS dark mode precision palette
export const darkRoles: M3ColorRoles = {
  primary: '#34C37A', // Electric Blue
  onPrimary: '#04210F',
  primaryContainer: '#0B3D24',
  onPrimaryContainer: '#C9F2D8',

  secondary: '#38B6F5', // Clean Emerald
  onSecondary: '#031B2B',
  secondaryContainer: '#0A3552',
  onSecondaryContainer: '#CDEBFC',

  tertiary: '#F59E0B', // Crisp Amber
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#78350F',
  onTertiaryContainer: '#FEF3C7',

  error: '#EF4444',
  onError: '#FFFFFF',
  errorContainer: '#7F1D1D',
  onErrorContainer: '#FEE2E2',

  background: '#08100C', // Deep workspace canvas
  onBackground: '#EAF3ED',

  surface: '#0E1813', // Slate 900 cards & panels
  onSurface: '#EAF3ED',
  surfaceVariant: '#1A2822',
  onSurfaceVariant: '#9DB1A6',
  surfaceContainerLowest: '#050A07',
  surfaceContainerLow: '#0A130E',
  surfaceContainer: '#0E1813',
  surfaceContainerHigh: '#1A2822',
  surfaceContainerHighest: '#2A3A32',

  outline: '#4A5C52',
  outlineVariant: '#1E2E26',
  inverseSurface: '#EAF3ED',
  inverseOnSurface: '#0F1A14',
  inversePrimary: '#0B7A3E',
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
