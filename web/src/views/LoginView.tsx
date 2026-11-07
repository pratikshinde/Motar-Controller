import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
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
import { BrandLogo } from '../components/brand/BrandLogo';
import { useLocale } from '../context/LocaleContext';
import { supportedLocales, localeLabels, type SupportedLocale } from '../i18n';

interface LoginViewProps {
  /** Kept so the old /register routes still render the page: there is no sign-up any more, only the sign-in. */
  defaultTab?: 'login' | 'register';
}

export const LoginView: React.FC<LoginViewProps> = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { locale, setLocale } = useLocale();

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
        <BrandLogo size="small" partnerName="Ajanta Pump Controller" />
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
          <Box />

          {/* Desktop Right Column Brand (Subtle) */}
          <Box sx={{ display: { xs: 'none', md: 'block' } }}>
            <BrandLogo size="small" partnerName="Ajanta Pump Controller" />
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
          <LoginForm />
        </Box>

        {/* Bottom Security / Copyright Note */}
        <Box sx={{ textAlign: 'center', pt: 3, borderTop: '1px solid #F1F5F9' }}>
          <Typography sx={{ fontSize: '0.78rem', color: '#94A3B8' }}>
            &copy; {new Date().getFullYear()} Ajanta Pump Controller &bull; Secured with TLS &amp; two-factor sign-in
          </Typography>
        </Box>
      </Box>
    </Box>
  );
};
