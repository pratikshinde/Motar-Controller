import React, { useState, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AppBar, Toolbar, Box, Typography, IconButton, Chip, Drawer, List,
  ListItemButton, ListItemIcon, ListItemText, BottomNavigation,
  BottomNavigationAction, useMediaQuery, useTheme, Tooltip, Avatar
} from '@mui/material';
import ElectricBoltIcon from '@mui/icons-material/ElectricBolt';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import SettingsIcon from '@mui/icons-material/Settings';
import LogoutIcon from '@mui/icons-material/Logout';
import { useColorMode } from '../theme/ColorModeContext';
import { useAuth } from '../context/AuthContext';
import { useBranding } from '../context/BrandingContext';
import { useLocale } from '../context/LocaleContext';
import { useWs } from '../context/WebSocketContext';
import { useToast } from '../context/ToastContext';
import { ROLE_NAMES } from '../api/users';
import { navItems } from './navItems';
import { SettingsDialog } from './SettingsDialog';
import { MfaSetupDialog } from './MfaSetupDialog';
import { BrandLogo } from './brand/BrandLogo';

const RAIL_WIDTH = 88;
const DRAWER_WIDTH = 260;

export const AppShell: React.FC = () => {
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down('sm')); // <600: bottom nav
  const isExpanded = useMediaQuery(theme.breakpoints.up('md')); // >=900: full drawer
  // medium (600-899): navigation rail

  const { mode, toggleMode } = useColorMode();
  const { user, logout } = useAuth();
  const { branding } = useBranding();
  const { t } = useLocale();
  const { subscribe } = useWs();
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // App-wide alert notification (FR-WEB-060/062), independent of which
  // page is open. Rides the alert engine's `alert`/`alert_digest` WS
  // messages — already deduplicated and subscription-filtered server-side
  // (backend/services/alertEngine.js), so this only fires once per real
  // new occurrence a user actually cares about, not on every raw fault
  // broadcast the way the pre-alert-engine version of this effect did.
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
  const visibleNavItems = navItems.filter(item => !item.roles || (user && item.roles.includes(user.role)));

  const navList = (
    <List sx={{ pt: 1, px: isExpanded ? 1.5 : 1 }}>
      {visibleNavItems.map(item => {
        const Icon = item.icon;
        const selected = location.pathname === item.path;
        return (
          <ListItemButton
            key={item.path}
            selected={selected}
            onClick={() => navigate(item.path)}
            sx={
              isExpanded
                ? { mb: 0.5 }
                : {
                    flexDirection: 'column',
                    gap: 0.25,
                    py: 1.25,
                    mb: 1,
                    minHeight: 56,
                    textAlign: 'center'
                  }
            }
          >
            <ListItemIcon sx={isExpanded ? {} : { minWidth: 0, justifyContent: 'center' }}>
              <Icon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary={t[item.labelKey]}
              slotProps={{
                primary: isExpanded
                  ? { variant: 'body2', sx: { fontWeight: 600 } }
                  : { variant: 'caption', sx: { fontWeight: 700 } }
              }}
            />
          </ListItemButton>
        );
      })}
    </List>
  );

  return (
    <Box sx={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <AppBar position="fixed" sx={{ zIndex: theme.zIndex.drawer + 1 }}>
        <Toolbar sx={{ gap: 1.5 }}>
          {branding?.logo_url ? (
            <Box
              component="img"
              src={branding.logo_url}
              alt=""
              sx={{ width: 36, height: 36, borderRadius: 2.5, objectFit: 'contain' }}
            />
          ) : (
            <BrandLogo size="small" light={mode === 'dark'} iconOnlyOnPhone />
          )}
          <Box sx={{ flexGrow: 1 }} />

          {user && (
            <Chip
              avatar={<Avatar sx={{ bgcolor: theme.palette.m3.secondaryContainer, color: theme.palette.m3.onSecondaryContainer }}>{user.full_name.charAt(0)}</Avatar>}
              label={roleName}
              variant="outlined"
              sx={{ display: { xs: 'none', sm: 'flex' } }}
            />
          )}

          <Tooltip title={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
            <IconButton onClick={toggleMode} color="inherit">
              {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          </Tooltip>
          <Tooltip title={t.settingsTitle}>
            <IconButton onClick={() => setSettingsOpen(true)} color="inherit">
              <SettingsIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title={t.btnLogout}>
            <IconButton onClick={() => logout()} color="inherit">
              <LogoutIcon />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      {!isCompact && (
        <Drawer
          variant="permanent"
          sx={{
            width: railOrDrawerWidth,
            flexShrink: 0,
            [`& .MuiDrawer-paper`]: { width: railOrDrawerWidth, boxSizing: 'border-box', pt: 8 }
          }}
        >
          {navList}
        </Drawer>
      )}

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          pt: 8,
          pb: isCompact ? 8 : 0,
          height: '100vh',
          overflow: 'auto',
          bgcolor: 'transparent' // Allow global gradient to show through
        }}
      >
        <Box sx={{ 
          p: { xs: 2, sm: 3, md: 4, lg: 6 }, 
          height: isCompact ? 'calc(100% - 64px)' : '100%', 
          boxSizing: 'border-box',
          maxWidth: 1400,
          mx: 'auto',
          animation: 'fadeIn 0.5s ease-out'
        }}>
          <Outlet />
        </Box>
      </Box>

      {isCompact && (
        <BottomNavigation
          value={location.pathname}
          onChange={(_, val) => navigate(val)}
          showLabels
          sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: theme.zIndex.drawer + 1 }}
        >
          {visibleNavItems.map(item => {
            const Icon = item.icon;
            return (
              <BottomNavigationAction
                key={item.path}
                value={item.path}
                label={t[item.labelKey]}
                icon={<Icon fontSize="small" />}
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
