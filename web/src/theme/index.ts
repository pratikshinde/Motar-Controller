import { createTheme, alpha, type ThemeOptions, type PaletteMode } from '@mui/material/styles';
import { lightRoles, darkRoles, shape, elevationTintOpacity, type M3ColorRoles } from './tokens';
// Pulls in the `MuiDataGrid` key on the theme's `components` map — MUI X
// ships this augmentation separately so apps that don't use DataGrid don't
// pay for it.
import type {} from '@mui/x-data-grid/themeAugmentation';

// ---------------------------------------------------------------------------
// Module augmentation: MUI's palette has no notion of M3 "container" roles
// or surface-container tiers. Rather than bolt these on as sx-prop magic
// strings everywhere, they're first-class palette entries so every
// component can reach theme.palette.primaryContainer the same way it
// reaches theme.palette.primary.
// ---------------------------------------------------------------------------
declare module '@mui/material/styles' {
  interface Palette {
    m3: M3ColorRoles;
  }
  interface PaletteOptions {
    m3: M3ColorRoles;
  }
  interface TypeBackground {
    surfaceVariant: string;
  }
}

function buildPalette(mode: PaletteMode, customRoles?: M3ColorRoles) {
  const roles = customRoles || (mode === 'dark' ? darkRoles : lightRoles);
  return {
    mode,
    m3: roles,
    primary: { main: roles.primary, contrastText: roles.onPrimary },
    secondary: { main: roles.secondary, contrastText: roles.onSecondary },
    error: { main: roles.error, contrastText: roles.onError },
    warning: { main: roles.tertiary, contrastText: roles.onTertiary },
    background: { default: roles.background, paper: roles.surface, surfaceVariant: roles.surfaceVariant },
    text: { primary: roles.onSurface, secondary: roles.onSurfaceVariant },
    divider: roles.outlineVariant
  };
}

// M3 type scale mapped onto MUI's variant names. Family choices keep the
// product's existing brand identity (Space Grotesk for display/headline,
// Plus Jakarta Sans for UI text, JetBrains Mono for telemetry figures)
// while the metrics (size/line-height/weight/tracking) follow the M3 spec.
const displayFont = "'Space Grotesk', 'Plus Jakarta Sans', sans-serif";
const bodyFont = "'Plus Jakarta Sans', sans-serif";
export const monoFont = "'JetBrains Mono', ui-monospace, monospace";

const typography: ThemeOptions['typography'] = {
  fontFamily: bodyFont,
  h1: { fontFamily: displayFont, fontSize: '2rem', lineHeight: 2.5 / 2, fontWeight: 400 }, // headlineLarge
  h2: { fontFamily: displayFont, fontSize: '1.75rem', lineHeight: 2.25 / 1.75, fontWeight: 400 }, // headlineMedium
  h3: { fontFamily: displayFont, fontSize: '1.5rem', lineHeight: 2 / 1.5, fontWeight: 400 }, // headlineSmall
  h4: { fontFamily: displayFont, fontSize: '1.375rem', lineHeight: 1.75 / 1.375, fontWeight: 500 }, // titleLarge
  h5: { fontFamily: bodyFont, fontSize: '1rem', lineHeight: 1.5, fontWeight: 600, letterSpacing: 0.15 }, // titleMedium
  h6: { fontFamily: bodyFont, fontSize: '0.875rem', lineHeight: 1.25 / 0.875, fontWeight: 600, letterSpacing: 0.1 }, // titleSmall
  subtitle1: { fontFamily: bodyFont, fontSize: '1rem', lineHeight: 1.5, fontWeight: 500, letterSpacing: 0.15 },
  subtitle2: { fontFamily: bodyFont, fontSize: '0.875rem', lineHeight: 1.25 / 0.875, fontWeight: 500, letterSpacing: 0.1 },
  body1: { fontFamily: bodyFont, fontSize: '1rem', lineHeight: 1.5, fontWeight: 400, letterSpacing: 0.5 }, // bodyLarge
  body2: { fontFamily: bodyFont, fontSize: '0.875rem', lineHeight: 1.25 / 0.875, fontWeight: 400, letterSpacing: 0.25 }, // bodyMedium
  caption: { fontFamily: bodyFont, fontSize: '0.75rem', lineHeight: 1, fontWeight: 400, letterSpacing: 0.4 }, // bodySmall
  overline: { fontFamily: bodyFont, fontSize: '0.6875rem', lineHeight: 1, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }, // labelSmall
  button: { fontFamily: bodyFont, fontSize: '0.875rem', lineHeight: 1.25 / 0.875, fontWeight: 600, letterSpacing: 0.1, textTransform: 'none' } // labelLarge — M3 buttons are not uppercase
};

// `brandRoles` is the per-partner palette resolved from FR-WEB-036
// branding (see theme/dynamicPalette.ts) — omitted, the app renders its
// own default AgriPump seed exactly as before.
export function buildAppTheme(mode: PaletteMode, brandRoles?: M3ColorRoles) {
  const roles = brandRoles || (mode === 'dark' ? darkRoles : lightRoles);
  const palette = buildPalette(mode, brandRoles);

  return createTheme({
    palette,
    typography,
    shape: { borderRadius: shape.medium },
    spacing: 8,
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { backgroundColor: roles.background, colorScheme: mode }
        }
      },
      // M3 tonal elevation: a primary-tinted wash over the surface, layered
      // with a soft shadow, instead of a flat darker/lighter box-shadow.
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
          elevation0: { backgroundColor: roles.surface },
          elevation1: {
            backgroundImage: `linear-gradient(${alpha(roles.primary, elevationTintOpacity[1])}, ${alpha(roles.primary, elevationTintOpacity[1])})`,
            backgroundColor: roles.surfaceContainerLow,
            boxShadow: mode === 'dark' ? '0 1px 3px rgba(0,0,0,0.5)' : '0 1px 3px rgba(0,0,0,0.12)'
          },
          elevation2: {
            backgroundImage: `linear-gradient(${alpha(roles.primary, elevationTintOpacity[2])}, ${alpha(roles.primary, elevationTintOpacity[2])})`,
            backgroundColor: roles.surfaceContainer,
            boxShadow: mode === 'dark' ? '0 2px 6px rgba(0,0,0,0.55)' : '0 2px 6px rgba(0,0,0,0.14)'
          },
          elevation3: {
            backgroundImage: `linear-gradient(${alpha(roles.primary, elevationTintOpacity[3])}, ${alpha(roles.primary, elevationTintOpacity[3])})`,
            backgroundColor: roles.surfaceContainerHigh,
            boxShadow: mode === 'dark' ? '0 4px 10px rgba(0,0,0,0.6)' : '0 4px 10px rgba(0,0,0,0.16)'
          }
        }
      },
      MuiCard: {
        defaultProps: { elevation: 1 },
        styleOverrides: {
          root: { borderRadius: shape.medium, border: `1px solid ${roles.outlineVariant}` }
        }
      },
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: shape.full, paddingInline: 20, textTransform: 'none' },
          outlined: { borderColor: roles.outline }
        },
        variants: [
          {
            // M3 "tonal" filled button — MUI has no native variant for this,
            // so it's added as a custom variant on top of contained/outlined/text.
            props: { variant: 'tonal' as never },
            style: {
              backgroundColor: roles.secondaryContainer,
              color: roles.onSecondaryContainer,
              '&:hover': { backgroundColor: alpha(roles.secondaryContainer, 0.9) }
            }
          }
        ]
      },
      MuiChip: {
        styleOverrides: { root: { borderRadius: shape.full, fontWeight: 600 } }
      },
      MuiDialog: {
        styleOverrides: { paper: { borderRadius: shape.extraLarge } }
      },
      MuiTextField: {
        defaultProps: { variant: 'outlined' }
      },
      MuiOutlinedInput: {
        styleOverrides: { root: { borderRadius: shape.small } }
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: roles.surfaceContainer,
            color: roles.onSurface,
            boxShadow: 'none',
            borderBottom: `1px solid ${roles.outlineVariant}`
          }
        }
      },
      MuiDrawer: {
        styleOverrides: {
          paper: { backgroundColor: roles.surfaceContainerLow, borderRight: `1px solid ${roles.outlineVariant}` }
        }
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: shape.full,
            '&.Mui-selected': {
              backgroundColor: roles.secondaryContainer,
              color: roles.onSecondaryContainer,
              '& .MuiListItemIcon-root': { color: roles.onSecondaryContainer }
            }
          }
        }
      },
      MuiTableCell: {
        styleOverrides: { root: { borderColor: roles.outlineVariant } }
      },
      MuiDataGrid: {
        styleOverrides: {
          root: { border: `1px solid ${roles.outlineVariant}`, borderRadius: shape.medium }
        }
      }
    }
  });
}

// TypeScript augmentation for the custom `tonal` Button variant.
declare module '@mui/material/Button' {
  interface ButtonPropsVariantOverrides {
    tonal: true;
  }
}
