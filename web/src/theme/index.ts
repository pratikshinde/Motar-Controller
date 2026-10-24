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
// Professional modern application font stack
const displayFont = "-apple-system, BlinkMacSystemFont, 'Inter', 'Plus Jakarta Sans', 'Segoe UI', Roboto, sans-serif";
const bodyFont = "-apple-system, BlinkMacSystemFont, 'Inter', 'Plus Jakarta Sans', 'Segoe UI', Roboto, sans-serif";
export const monoFont = "'JetBrains Mono', 'SF Mono', Consolas, Menlo, monospace";

/**
 * Clean workspace background - neutral canvas with subtle micro-tint
 */
export function ambientBackgroundImage(mode: PaletteMode, roles: M3ColorRoles): string {
  if (mode === 'dark') {
    return `radial-gradient(ellipse 80% 50% at 50% -20%, rgba(37, 99, 235, 0.12), transparent)`;
  }
  return `linear-gradient(180deg, #F8FAFC 0%, #F1F5F9 100%)`;
}

const typography: ThemeOptions['typography'] = {
  fontFamily: bodyFont,
  h1: { fontFamily: displayFont, fontSize: '1.875rem', lineHeight: 1.25, fontWeight: 700, letterSpacing: '-0.025em' },
  h2: { fontFamily: displayFont, fontSize: '1.5rem', lineHeight: 1.3, fontWeight: 700, letterSpacing: '-0.02em' },
  h3: { fontFamily: displayFont, fontSize: '1.25rem', lineHeight: 1.35, fontWeight: 600, letterSpacing: '-0.015em' },
  h4: { fontFamily: displayFont, fontSize: '1.125rem', lineHeight: 1.4, fontWeight: 600, letterSpacing: '-0.01em' },
  h5: { fontFamily: bodyFont, fontSize: '0.9375rem', lineHeight: 1.45, fontWeight: 600, letterSpacing: '-0.005em' },
  h6: { fontFamily: bodyFont, fontSize: '0.875rem', lineHeight: 1.4, fontWeight: 600 },
  subtitle1: { fontFamily: bodyFont, fontSize: '0.875rem', lineHeight: 1.45, fontWeight: 500 },
  subtitle2: { fontFamily: bodyFont, fontSize: '0.8125rem', lineHeight: 1.4, fontWeight: 500 },
  body1: { fontFamily: bodyFont, fontSize: '0.875rem', lineHeight: 1.5, fontWeight: 400 },
  body2: { fontFamily: bodyFont, fontSize: '0.8125rem', lineHeight: 1.45, fontWeight: 400 },
  caption: { fontFamily: bodyFont, fontSize: '0.75rem', lineHeight: 1.35, fontWeight: 400 },
  overline: { fontFamily: bodyFont, fontSize: '0.6875rem', lineHeight: 1.2, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' },
  button: { fontFamily: bodyFont, fontSize: '0.8125rem', lineHeight: 1.3, fontWeight: 600, letterSpacing: '0.01em', textTransform: 'none' }
};

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
          body: {
            backgroundColor: roles.background,
            colorScheme: mode,
            backgroundImage: ambientBackgroundImage(mode, roles),
            backgroundAttachment: 'fixed',
            minHeight: '100vh',
            color: roles.onBackground,
            letterSpacing: '-0.006em'
          }
        }
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            borderRadius: shape.medium,
            border: `1px solid ${roles.outlineVariant}`
          },
          elevation0: {
            backgroundColor: roles.surface,
            boxShadow: 'none',
            border: `1px solid ${roles.outlineVariant}`
          },
          elevation1: {
            backgroundColor: roles.surface,
            boxShadow: mode === 'dark'
              ? '0 1px 2px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.2)'
              : '0 1px 3px rgba(15, 23, 42, 0.05), 0 1px 2px rgba(15, 23, 42, 0.03)'
          },
          elevation2: {
            backgroundColor: roles.surface,
            boxShadow: mode === 'dark'
              ? '0 4px 8px rgba(0,0,0,0.5), 0 2px 4px rgba(0,0,0,0.3)'
              : '0 4px 6px -1px rgba(15, 23, 42, 0.07), 0 2px 4px -2px rgba(15, 23, 42, 0.05)'
          },
          elevation3: {
            backgroundColor: roles.surface,
            boxShadow: mode === 'dark'
              ? '0 8px 16px rgba(0,0,0,0.6)'
              : '0 10px 15px -3px rgba(15, 23, 42, 0.08), 0 4px 6px -4px rgba(15, 23, 42, 0.04)'
          }
        }
      },
      MuiCard: {
        defaultProps: { elevation: 1 },
        styleOverrides: {
          root: {
            borderRadius: shape.medium,
            border: `1px solid ${roles.outlineVariant}`,
            backgroundColor: roles.surface,
            transition: 'border-color 0.15s ease, box-shadow 0.15s ease'
          }
        }
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: shape.small,
            paddingInline: 14,
            paddingBlock: 6,
            textTransform: 'none',
            fontWeight: 600,
            transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)'
          },
          contained: {
            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
            '&:hover': {
              boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
            }
          },
          outlined: {
            borderColor: roles.outlineVariant,
            backgroundColor: alpha(roles.surface, 0.5),
            '&:hover': {
              borderColor: roles.outline,
              backgroundColor: roles.surfaceVariant
            }
          }
        },
        variants: [
          {
            props: { variant: 'tonal' as never },
            style: {
              backgroundColor: roles.primaryContainer,
              color: roles.onPrimaryContainer,
              border: `1px solid ${alpha(roles.primary, 0.15)}`,
              '&:hover': {
                backgroundColor: alpha(roles.primaryContainer, 0.8)
              }
            }
          }
        ]
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: shape.small,
            fontWeight: 600,
            fontSize: '0.75rem',
            height: 24
          }
        }
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: shape.large,
            border: `1px solid ${roles.outlineVariant}`,
            boxShadow: mode === 'dark' ? '0 20px 25px -5px rgba(0, 0, 0, 0.7)' : '0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 8px 10px -6px rgba(15, 23, 42, 0.05)'
          }
        }
      },
      MuiTextField: {
        defaultProps: { variant: 'outlined', size: 'small' }
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: shape.small,
            backgroundColor: roles.surface,
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: roles.outline
            },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: roles.primary,
              borderWidth: 1.5
            }
          },
          notchedOutline: {
            borderColor: roles.outlineVariant
          }
        }
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: alpha(roles.surface, 0.92),
            backdropFilter: 'blur(12px)',
            color: roles.onSurface,
            boxShadow: 'none',
            borderBottom: `1px solid ${roles.outlineVariant}`
          }
        }
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: roles.surface,
            borderRight: `1px solid ${roles.outlineVariant}`
          }
        }
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: shape.small,
            marginBlock: 2,
            transition: 'background-color 0.12s ease',
            '&:hover': {
              backgroundColor: roles.surfaceVariant
            },
            '&.Mui-selected': {
              backgroundColor: roles.primaryContainer,
              color: roles.onPrimaryContainer,
              fontWeight: 600,
              '& .MuiListItemIcon-root': { color: roles.onPrimaryContainer },
              '&:hover': {
                backgroundColor: alpha(roles.primaryContainer, 0.85)
              }
            }
          }
        }
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderColor: roles.outlineVariant,
            paddingTop: 10,
            paddingBottom: 10,
            fontSize: '0.8125rem'
          },
          head: {
            fontWeight: 600,
            backgroundColor: roles.surfaceVariant,
            color: roles.onSurfaceVariant
          }
        }
      },
      MuiDataGrid: {
        styleOverrides: {
          root: {
            border: `1px solid ${roles.outlineVariant}`,
            borderRadius: shape.medium,
            backgroundColor: roles.surface,
            '& .MuiDataGrid-columnHeaders': {
              backgroundColor: roles.surfaceVariant,
              borderBottom: `1px solid ${roles.outlineVariant}`,
              fontSize: '0.75rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: roles.onSurfaceVariant
            },
            '& .MuiDataGrid-row:hover': {
              backgroundColor: alpha(roles.surfaceVariant, 0.6)
            },
            '& .MuiDataGrid-cell': {
              borderBottom: `1px solid ${roles.outlineVariant}`,
              fontSize: '0.8125rem'
            }
          }
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
