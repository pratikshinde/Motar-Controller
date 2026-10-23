import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Tabs,
  Tab,
  Button,
  Menu,
  MenuItem,
  useTheme,
  useMediaQuery
} from '@mui/material';
import LanguageIcon from '@mui/icons-material/Language';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate, useLocation } from 'react-router-dom';
import { AuthHeroPanel } from './auth/AuthHeroPanel';
import { LoginForm } from './auth/LoginForm';
import { CreateAccountForm } from './auth/CreateAccountForm';
import { BrandLogo } from '../components/brand/BrandLogo';
import { useLocale } from '../context/LocaleContext';
import { supportedLocales, localeLabels, type SupportedLocale } from '../i18n';

interface LoginViewProps {
  defaultTab?: 'login' | 'register';
}

export const LoginView: React.FC<LoginViewProps> = ({ defaultTab = 'login' }) => {
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { locale, setLocale } = useLocale();

  const [tab, setTab] = useState<'login' | 'register'>(
    location.pathname.includes('/register') ? 'register' : defaultTab
  );
  const [selectedRole, setSelectedRole] = useState<string | null>(null);

  // Sync tab if URL changes
  useEffect(() => {
    if (location.pathname.includes('/register')) {
      setTab('register');
    } else if (location.pathname.includes('/login')) {
      setTab('login');
    }
  }, [location.pathname]);

  const handleTabChange = (_: React.SyntheticEvent, newTab: 'login' | 'register') => {
    setTab(newTab);
    setSelectedRole(null);
    if (newTab === 'register') {
      window.history.replaceState(null, '', '/register');
    } else {
      window.history.replaceState(null, '', '/login');
    }
  };

  const handleSelectRoleFromLogin = (roleId: string) => {
    setSelectedRole(roleId);
    setTab('register');
    window.history.replaceState(null, '', '/register');
  };

  // Language Menu dropdown
  const [langAnchor, setLangAnchor] = useState<null | HTMLElement>(null);
  const handleLangClose = (selected?: SupportedLocale) => {
    setLangAnchor(null);
    if (selected) setLocale(selected);
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        // 100%, not 100vw: vw counts the scrollbar, so on a page tall enough to scroll the view was a scrollbar's width
        // too wide and grew a horizontal scrollbar of its own.
        width: '100%',
        bgcolor: '#FFFFFF',
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row' },
        overflowX: 'hidden'
      }}
    >
      {/* LEFT COLUMN: Industrial IoT & Agriculture Brand Showcase */}
      <Box
        sx={{
          width: { xs: '100%', md: '48%', lg: '50%' },
          display: { xs: 'none', md: 'block' },
          position: 'sticky',
          top: 0,
          height: '100vh',
          flexShrink: 0
        }}
      >
        <AuthHeroPanel />
      </Box>

      {/* MOBILE HEADER (when on phone/tablet) */}
      <Box
        sx={{
          display: { xs: 'flex', md: 'none' },
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2.5,
          py: 2,
          borderBottom: '1px solid #E2E8F0',
          bgcolor: '#FFFFFF'
        }}
      >
        <BrandLogo size="small" onClick={() => navigate('/')} />
        <Button
          size="small"
          onClick={() => navigate('/')}
          startIcon={<ArrowBackIcon sx={{ fontSize: 16 }} />}
          sx={{ textTransform: 'none', color: '#64748B', fontWeight: 600, fontSize: '0.82rem' }}
        >
          Home
        </Button>
      </Box>

      {/* RIGHT COLUMN: Authentication Container */}
      <Box
        sx={{
          flexGrow: 1,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          p: { xs: 2.5, sm: 4, lg: 6 },
          bgcolor: '#FFFFFF',
          overflowY: 'auto'
        }}
      >
        {/* Top Bar inside Right Column: Back link & Language picker */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: { xs: 2.5, md: 4 }
          }}
        >
          {/* Back to Home link on desktop */}
          <Button
            size="small"
            startIcon={<ArrowBackIcon sx={{ fontSize: 16 }} />}
            onClick={() => navigate('/')}
            sx={{
              display: { xs: 'none', md: 'inline-flex' },
              color: '#64748B',
              textTransform: 'none',
              fontWeight: 600,
              fontSize: '0.85rem',
              '&:hover': { color: '#2563EB', bgcolor: 'transparent' }
            }}
          >
            Back to Home
          </Button>

          {/* Desktop Right Column Brand (Subtle) */}
          <Box sx={{ display: { xs: 'none', md: 'block' } }}>
            <BrandLogo size="small" />
          </Box>

          {/* Language Selector */}
          <Button
            size="small"
            onClick={e => setLangAnchor(e.currentTarget)}
            startIcon={<LanguageIcon sx={{ fontSize: 17, color: '#64748B' }} />}
            endIcon={<ArrowDropDownIcon sx={{ fontSize: 18, color: '#64748B' }} />}
            sx={{
              color: '#334155',
              fontSize: '0.82rem',
              fontWeight: 600,
              textTransform: 'none',
              px: 1.25,
              py: 0.5,
              borderRadius: 2,
              border: '1px solid #E2E8F0',
              bgcolor: '#F8FAFC',
              '&:hover': { bgcolor: '#F1F5F9' }
            }}
          >
            {locale === 'hi' ? 'हिन्दी' : 'English'}
          </Button>

          <Menu
            anchorEl={langAnchor}
            open={Boolean(langAnchor)}
            onClose={() => handleLangClose()}
            slotProps={{ paper: { sx: { borderRadius: 2, minWidth: 130 } } }}
          >
            {supportedLocales.map(l => (
              <MenuItem
                key={l}
                selected={locale === l}
                onClick={() => handleLangClose(l)}
                sx={{ fontSize: '0.86rem', fontWeight: locale === l ? 700 : 500 }}
              >
                {localeLabels[l]}
              </MenuItem>
            ))}
          </Menu>
        </Box>

        {/* Center: Tabs & Main Form */}
        <Box sx={{ my: 'auto', py: { xs: 1, md: 2 } }}>
          {/* Top Tabs: [ Login ]   [ Create Account ] */}
          <Box sx={{ maxWidth: 460, mx: 'auto', mb: 3.5 }}>
            <Tabs
              value={tab}
              onChange={handleTabChange}
              variant="fullWidth"
              sx={{
                bgcolor: '#F1F5F9',
                borderRadius: 2.5,
                p: 0.5,
                minHeight: 46,
                '& .MuiTabs-indicator': {
                  bgcolor: '#FFFFFF',
                  height: '100%',
                  borderRadius: 2,
                  boxShadow: '0 2px 6px rgba(15, 23, 42, 0.08)'
                },
                '& .MuiTab-root': {
                  textTransform: 'none',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  color: '#64748B',
                  minHeight: 38,
                  zIndex: 1,
                  borderRadius: 2,
                  transition: 'all 0.2s ease',
                  '&.Mui-selected': {
                    color: '#0F172A',
                    fontWeight: 700
                  }
                }
              }}
            >
              <Tab label="Login" value="login" />
              <Tab label="Create Account" value="register" />
            </Tabs>
          </Box>

          {/* Form Switcher */}
          {tab === 'login' ? (
            <LoginForm
              onSwitchToRegister={() => {
                setTab('register');
                window.history.replaceState(null, '', '/register');
              }}
              onSelectRole={handleSelectRoleFromLogin}
            />
          ) : (
            <CreateAccountForm
              onSwitchToLogin={() => {
                setTab('login');
                window.history.replaceState(null, '', '/login');
              }}
              initialRole={selectedRole}
            />
          )}
        </Box>

        {/* Bottom Security / Copyright Note */}
        <Box sx={{ textAlign: 'center', pt: 3, borderTop: '1px solid #F1F5F9' }}>
          <Typography sx={{ fontSize: '0.78rem', color: '#94A3B8' }}>
            &copy; {new Date().getFullYear()} AgriPump SmartSpace &bull; Enterprise Agricultural IoT &bull; Secured with TLS &amp; TOTP
          </Typography>
        </Box>
      </Box>
    </Box>
  );
};
