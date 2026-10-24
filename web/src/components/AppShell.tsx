import React, { useState, useEffect, useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AppBar, Toolbar, Box, Typography, IconButton, Chip, Button, Drawer, List,
  ListItemButton, ListItemIcon, ListItemText, BottomNavigation,
  BottomNavigationAction, useMediaQuery, useTheme, Tooltip, Avatar, Divider
} from '@mui/material';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined';
import WifiOutlinedIcon from '@mui/icons-material/WifiOutlined';
import { useColorMode } from '../theme/ColorModeContext';
import { useAuth } from '../context/AuthContext';
import { useBranding } from '../context/BrandingContext';
import { useLocale } from '../context/LocaleContext';
import { useWs } from '../context/WebSocketContext';
import { useToast } from '../context/ToastContext';
import { ROLE_NAMES } from '../api/users';
import { navSections, navItems } from './navItems';
import { SettingsDialog } from './SettingsDialog';
import { MfaSetupDialog } from './MfaSetupDialog';
import { BrandLogo } from './brand/BrandLogo';
import { ManufacturerSwitcher } from './ManufacturerSwitcher';
import { setViewing, useViewing } from '../api/viewing';

const DRAWER_WIDTH = 256;
const RAIL_WIDTH = 76;
const APPBAR_HEIGHT = 52;

export const AppShell: React.FC = () => {
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down('sm')); // <600: bottom nav
  const isExpanded = useMediaQuery(theme.breakpoints.up('md')); // >=900: full drawer

  const { mode, toggleMode } = useColorMode();
  const { user, logout } = useAuth();
  const { branding } = useBranding();
  const { t } = useLocale();
  const { subscribe, status: wsStatus } = useWs();
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const viewing = useViewing();
  const viewingBannerHeight = viewing ? 34 : 0;

  useEffect(() => {
    const unsubAlert = subscribe('alert', msg => {
      const a = msg.alert;
      const what = a.alert_type === 'OFFLINE' ? 'Device offline' : a.fault_name || `Fault code ${a.fault_code}`;
      showToast(`⚠️ ${a.severity} — ${what} on ${a.pump_name}`, true);
    });
    const unsubDigest = subscribe('alert_digest', msg => {
      showToast(`⚠️ ${msg.alerts.length} new alerts — see Alerts`, true);
    });
    return () => {
      unsubAlert();
      unsubDigest();
    };
  }, [subscribe, showToast]);

  const roleName = user ? ROLE_NAMES[user.role] : '';
  const railOrDrawerWidth = isExpanded ? DRAWER_WIDTH : RAIL_WIDTH;

  // Filter sections and items based on role and viewing mode
  const filteredSections = useMemo(() => {
    return navSections
      .map(sec => ({
        ...sec,
        items: sec.items.filter(
          item => (!item.roles || (user && item.roles.includes(user.role))) && !(viewing && item.platformOnly)
        )
      }))
      .filter(sec => sec.items.length > 0);
  }, [user, viewing]);

  const visibleNavItems = useMemo(() => {
    return navItems.filter(
      item => (!item.roles || (user && item.roles.includes(user.role))) && !(viewing && item.platformOnly)
    );
  }, [user, viewing]);

  // Current page title
  const currentNavItem = visibleNavItems.find(item => item.path === location.pathname);
  const pageTitle = currentNavItem ? t[currentNavItem.labelKey] : 'Dashboard';

  const navList = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Brand logo container at top of sidebar */}
      <Box
        sx={{
          height: APPBAR_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          px: isExpanded ? 2.5 : 1.5,
          borderBottom: `1px solid ${theme.palette.divider}`,
          justifyContent: isExpanded ? 'flex-start' : 'center'
        }}
      >
        {branding?.logo_url ? (
          <Box
            component="img"
            src={branding.logo_url}
            alt=""
            sx={{ width: 30, height: 30, borderRadius: 1.5, objectFit: 'contain' }}
          />
        ) : (
          <BrandLogo size="small" light={mode === 'dark'} iconOnlyOnPhone={!isExpanded} />
        )}
      </Box>

      {/* Nav List */}
      <Box sx={{ flex: 1, overflowY: 'auto', py: 1.5, px: isExpanded ? 1.5 : 0.75 }}>
        {filteredSections.map((sec, secIdx) => (
          <Box key={sec.title} sx={{ mb: 1.5 }}>
            {isExpanded && (
              <Typography
                variant="overline"
                sx={{
                  px: 1.5,
                  py: 0.5,
                  display: 'block',
                  color: 'text.secondary',
                  fontSize: '0.6875rem',
                  fontWeight: 700,
                  letterSpacing: '0.06em'
                }}
              >
                {sec.title}
              </Typography>
            )}
            {!isExpanded && secIdx > 0 && <Divider sx={{ my: 1 }} />}
            <List disablePadding>
              {sec.items.map(item => {
                const Icon = item.icon;
                const isSelected = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(`${item.path}/`));
                return (
                  <Tooltip key={item.path} title={!isExpanded ? t[item.labelKey] : ''} placement="right">
                    <ListItemButton
                      selected={isSelected}
                      onClick={() => navigate(item.path)}
                      sx={
                        isExpanded
                          ? {
                              mb: 0.5,
                              py: 0.75,
                              px: 1.5,
                              borderRadius: 1.5,
                              position: 'relative',
                              color: isSelected ? 'primary.main' : 'text.primary',
                              bgcolor: isSelected ? 'primaryContainer' : 'transparent',
                              '&:hover': {
                                bgcolor: isSelected ? 'primaryContainer' : 'background.surfaceVariant'
                              },
                              ...(isSelected && {
                                '&::before': {
                                  content: '""',
                                  position: 'absolute',
                                  left: 0,
                                  top: '20%',
                                  bottom: '20%',
                                  width: 3,
                                  bgcolor: 'primary.main',
                                  borderRadius: '0 3px 3px 0'
                                }
                              })
                            }
                          : {
                              flexDirection: 'column',
                              gap: 0.25,
                              py: 1,
                              px: 0.5,
                              mb: 0.5,
                              borderRadius: 1.5,
                              minHeight: 48,
                              textAlign: 'center',
                              color: isSelected ? 'primary.main' : 'text.primary',
                              bgcolor: isSelected ? 'primaryContainer' : 'transparent'
                            }
                      }
                    >
                      <ListItemIcon
                        sx={{
                          minWidth: isExpanded ? 32 : 0,
                          justifyContent: 'center',
                          color: isSelected ? 'primary.main' : 'text.secondary'
                        }}
                      >
                        <Icon sx={{ fontSize: 19 }} />
                      </ListItemIcon>
                      {isExpanded ? (
                        <ListItemText
                          primary={t[item.labelKey]}
                          slotProps={{
                            primary: {
                              variant: 'body2',
                              sx: {
                                fontWeight: isSelected ? 600 : 500,
                                fontSize: '0.8125rem'
                              }
                            }
                          }}
                        />
                      ) : null}
                    </ListItemButton>
                  </Tooltip>
                );
              })}
            </List>
          </Box>
        ))}
      </Box>

      {/* User profile strip at bottom of sidebar */}
      {user && isExpanded && (
        <Box
          sx={{
            p: 1.5,
            borderTop: `1px solid ${theme.palette.divider}`,
            bgcolor: 'background.surfaceVariant',
            display: 'flex',
            alignItems: 'center',
            gap: 1.25
          }}
        >
          <Avatar
            sx={{
              width: 32,
              height: 32,
              bgcolor: 'primary.main',
              color: '#FFFFFF',
              fontSize: '0.8125rem',
              fontWeight: 700
            }}
          >
            {user.full_name?.charAt(0) || 'U'}
          </Avatar>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 600, fontSize: '0.8125rem', lineHeight: 1.2 }}>
              {user.full_name}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', fontSize: '0.6875rem' }}>
              {roleName}
            </Typography>
          </Box>
          <Tooltip title={t.btnLogout}>
            <IconButton size="small" onClick={() => logout()} sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}>
              <LogoutOutlinedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>
      )}
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', bgcolor: 'background.default' }}>
      {/* Top Application Bar */}
      <AppBar
        position="fixed"
        sx={{
          zIndex: theme.zIndex.drawer + 1,
          left: isCompact ? 0 : railOrDrawerWidth,
          width: isCompact ? '100%' : `calc(100% - ${railOrDrawerWidth}px)`,
          height: APPBAR_HEIGHT + viewingBannerHeight,
          boxShadow: 'none',
          borderBottom: `1px solid ${theme.palette.divider}`,
          bgcolor: 'background.paper',
          transition: 'all 0.15s ease'
        }}
      >
        <Toolbar
          variant="dense"
          sx={{
            height: APPBAR_HEIGHT,
            minHeight: APPBAR_HEIGHT,
            px: { xs: 1.5, sm: 2.5 },
            gap: 1.5,
            alignItems: 'center'
          }}
        >
          {/* Mobile brand indicator */}
          {isCompact && (
            <BrandLogo size="small" light={mode === 'dark'} iconOnlyOnPhone />
          )}

          {/* Current Page Context / Breadcrumb */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="h5" sx={{ fontWeight: 600, color: 'text.primary', fontSize: '0.9375rem' }}>
              {pageTitle}
            </Typography>
          </Box>

          <Box sx={{ flexGrow: 1 }} />

          {/* Live WS Pulse Pill */}
          <Box
            sx={{
              display: { xs: 'none', sm: 'flex' },
              alignItems: 'center',
              gap: 0.75,
              px: 1.25,
              py: 0.35,
              borderRadius: 1,
              bgcolor: wsStatus === 'open' ? 'secondaryContainer' : 'background.surfaceVariant',
              border: `1px solid ${theme.palette.divider}`
            }}
          >
            <Box
              sx={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                bgcolor: wsStatus === 'open' ? 'secondary.main' : 'warning.main',
                boxShadow: wsStatus === 'open' ? '0 0 6px rgba(16, 185, 129, 0.6)' : 'none'
              }}
            />
            <Typography
              variant="caption"
              sx={{
                fontWeight: 600,
                fontSize: '0.6875rem',
                color: wsStatus === 'open' ? 'onSecondaryContainer' : 'text.secondary'
              }}
            >
              {wsStatus === 'open' ? 'Live Telemetry' : 'Reconnecting'}
            </Typography>
          </Box>

          {/* Manufacturer Switcher for Superadmin */}
          {user?.role === 'superadmin' && <ManufacturerSwitcher />}

          {/* User Role Tag */}
          {user && !isExpanded && (
            <Chip
              size="small"
              label={roleName}
              variant="outlined"
              sx={{ display: { xs: 'none', sm: 'inline-flex' }, height: 22, fontSize: '0.6875rem' }}
            />
          )}

          {/* Theme Mode Toggle */}
          <Tooltip title={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
            <IconButton onClick={toggleMode} size="small" sx={{ color: 'text.secondary' }}>
              {mode === 'dark' ? <LightModeOutlinedIcon sx={{ fontSize: 18 }} /> : <DarkModeOutlinedIcon sx={{ fontSize: 18 }} />}
            </IconButton>
          </Tooltip>

          {/* Settings */}
          <Tooltip title={t.settingsTitle}>
            <IconButton onClick={() => setSettingsOpen(true)} size="small" sx={{ color: 'text.secondary' }}>
              <SettingsOutlinedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>

          {/* Logout (shown in header for compact/rail mode) */}
          {!isExpanded && (
            <Tooltip title={t.btnLogout}>
              <IconButton onClick={() => logout()} size="small" sx={{ color: 'text.secondary' }}>
                <LogoutOutlinedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          )}
        </Toolbar>

        {/* Platform Owner Read-Only Banner */}
        {viewing && (
          <Box
            role="status"
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              height: 34,
              px: 2,
              bgcolor: 'tertiaryContainer',
              color: 'onTertiaryContainer',
              borderTop: `1px solid ${theme.palette.divider}`
            }}
          >
            <Typography variant="caption" noWrap sx={{ fontWeight: 600, fontSize: '0.75rem' }}>
              Viewing {viewing.name} as the platform owner · Read-only
            </Typography>
            <Button
              size="small"
              color="inherit"
              sx={{ textTransform: 'none', textDecoration: 'underline', minWidth: 0, p: 0, fontSize: '0.75rem', fontWeight: 700 }}
              onClick={() => {
                setViewing(null);
                navigate('/manufacturers');
              }}
            >
              Back to platform
            </Button>
          </Box>
        )}
      </AppBar>

      {/* Desktop / Tablet Sidebar */}
      {!isCompact && (
        <Drawer
          variant="permanent"
          sx={{
            width: railOrDrawerWidth,
            flexShrink: 0,
            [`& .MuiDrawer-paper`]: {
              width: railOrDrawerWidth,
              boxSizing: 'border-box',
              borderRight: `1px solid ${theme.palette.divider}`,
              bgcolor: 'background.paper',
              boxShadow: 'none'
            }
          }}
        >
          {navList}
        </Drawer>
      )}

      {/* Main Content Viewport */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          pt: `${APPBAR_HEIGHT + viewingBannerHeight + 16}px`,
          pb: isCompact ? 9 : 3,
          px: { xs: 2, sm: 3, md: 3.5 },
          height: '100vh',
          overflowY: 'auto',
          bgcolor: 'background.default'
        }}
      >
        <Box
          sx={{
            maxWidth: 1440,
            mx: 'auto',
            height: '100%',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <Outlet key={viewing?.key ?? 'platform'} />
        </Box>
      </Box>

      {/* Mobile Bottom Navigation */}
      {isCompact && (
        <BottomNavigation
          value={location.pathname}
          onChange={(_, val) => navigate(val)}
          showLabels
          sx={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: theme.zIndex.drawer + 1,
            borderTop: `1px solid ${theme.palette.divider}`,
            bgcolor: 'background.paper'
          }}
        >
          {visibleNavItems.slice(0, 5).map(item => {
            const Icon = item.icon;
            return (
              <BottomNavigationAction
                key={item.path}
                value={item.path}
                label={t[item.labelKey]}
                icon={<Icon sx={{ fontSize: 20 }} />}
              />
            );
          })}
        </BottomNavigation>
      )}

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <MfaSetupDialog />
    </Box>
  );
};

