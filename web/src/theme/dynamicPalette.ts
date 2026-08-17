/**
 * Per-partner white-labelling (FR-WEB-036, Web_App_Pending_Items.md §8.1):
 * turns one seed hex color into a full M3 light/dark tonal palette at
 * runtime, using Google's own material-color-utilities (HCT color space)
 * rather than hand-rolled color math — this is real perceptual color
 * science (CAM16/HCT), not the kind of thing worth re-deriving by hand the
 * way the project's simpler hand-rolled pieces (TOTP, JWT) are.
 *
 * `Scheme`/`CorePalette` are the library's older, simpler API (superseded
 * by `DynamicScheme`/`CorePalettes` for contrast-level-aware theming) but
 * still fully functional and sufficient here — this app doesn't need
 * per-user contrast preferences, just one correct light/dark pair per seed.
 */
import { Scheme, CorePalette, argbFromHex, hexFromArgb, type TonalPalette } from '@material/material-color-utilities';
import type { M3ColorRoles } from './tokens';

// `Scheme` doesn't expose the 5 surface-container tiers (an M3 concept
// added after this class) — they're picked directly off the neutral
// tonal palette at the tone stops published in the M3 color system spec.
const LIGHT_SURFACE_TONES = { lowest: 100, low: 96, container: 94, high: 92, highest: 90 };
const DARK_SURFACE_TONES = { lowest: 4, low: 10, container: 12, high: 17, highest: 22 };

function schemeToRoles(scheme: Scheme, neutralPalette: TonalPalette, tones: typeof LIGHT_SURFACE_TONES): M3ColorRoles {
  const hex = (argb: number) => hexFromArgb(argb);
  return {
    primary: hex(scheme.primary),
    onPrimary: hex(scheme.onPrimary),
    primaryContainer: hex(scheme.primaryContainer),
    onPrimaryContainer: hex(scheme.onPrimaryContainer),

    secondary: hex(scheme.secondary),
    onSecondary: hex(scheme.onSecondary),
    secondaryContainer: hex(scheme.secondaryContainer),
    onSecondaryContainer: hex(scheme.onSecondaryContainer),

    tertiary: hex(scheme.tertiary),
    onTertiary: hex(scheme.onTertiary),
    tertiaryContainer: hex(scheme.tertiaryContainer),
    onTertiaryContainer: hex(scheme.onTertiaryContainer),

    error: hex(scheme.error),
    onError: hex(scheme.onError),
    errorContainer: hex(scheme.errorContainer),
    onErrorContainer: hex(scheme.onErrorContainer),

    background: hex(scheme.background),
    onBackground: hex(scheme.onBackground),

    surface: hex(scheme.surface),
    onSurface: hex(scheme.onSurface),
    surfaceVariant: hex(scheme.surfaceVariant),
    onSurfaceVariant: hex(scheme.onSurfaceVariant),
    surfaceContainerLowest: hex(neutralPalette.tone(tones.lowest)),
    surfaceContainerLow: hex(neutralPalette.tone(tones.low)),
    surfaceContainer: hex(neutralPalette.tone(tones.container)),
    surfaceContainerHigh: hex(neutralPalette.tone(tones.high)),
    surfaceContainerHighest: hex(neutralPalette.tone(tones.highest)),

    outline: hex(scheme.outline),
    outlineVariant: hex(scheme.outlineVariant),
    inverseSurface: hex(scheme.inverseSurface),
    inverseOnSurface: hex(scheme.inverseOnSurface),
    inversePrimary: hex(scheme.inversePrimary),
    scrim: hex(scheme.scrim),
    shadow: hex(scheme.shadow)
  };
}

export function paletteFromSeed(seedHex: string): { light: M3ColorRoles; dark: M3ColorRoles } {
  const argb = argbFromHex(seedHex);
  const core = CorePalette.of(argb);
  return {
    light: schemeToRoles(Scheme.light(argb), core.n1, LIGHT_SURFACE_TONES),
    dark: schemeToRoles(Scheme.dark(argb), core.n1, DARK_SURFACE_TONES)
  };
}

export function isValidHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}
