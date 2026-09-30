import React, { useState } from 'react';
import {
  Box,
  Button,
  Menu,
  MenuItem,
  useTheme,
  useMediaQuery,
  Typography
} from '@mui/material';
import LanguageIcon from '@mui/icons-material/Language';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate } from 'react-router-dom';
import { AuthHeroPanel } from './AuthHeroPanel';
import { BrandLogo } from '../../components/brand/BrandLogo';
import { useLocale } from '../../context/LocaleContext';
import { supportedLocales, localeLabels, type SupportedLocale } from '../../i18n';

interface AuthPageLayoutProps {
  children: React.ReactNode;
  showBackHome?: boolean;
}

export const AuthPageLayout: React.FC<AuthPageLayoutProps> = ({
  children,
  showBackHome = true
}) => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { locale, setLocale } = useLocale();

  const [langAnchor, setLangAnchor] = useState<null | HTMLElement>(null);

  const handleLangClose = (selected?: SupportedLocale) => {
    setLangAnchor(null);
    if (selected) setLocale(selected);
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        width: '100vw',
        bgcolor: '#FFFFFF',
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row' },
        overflowX: 'hidden'
      }}
    >
      {/* Left Column: Industrial IoT Showcase (Sticky on desktop, hidden on mobile) */}
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

      {/* Mobile Top Header */}
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

      {/* Right Column: Active Authentication Screen */}
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
        {/* Top Bar inside right pane */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: { xs: 2, md: 3 }
          }}
        >
          {showBackHome ? (
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
          ) : (
            <Box />
          )}

          {/* Desktop Right Column Brand */}
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

        {/* Center: Main Page Content */}
        <Box sx={{ my: 'auto', py: { xs: 1, md: 2 } }}>
          {children}
        </Box>

        {/* Bottom Security / System status */}
        <Box sx={{ textAlign: 'center', pt: 3, borderTop: '1px solid #F1F5F9' }}>
          <Typography sx={{ fontSize: '0.78rem', color: '#94A3B8' }}>
            &copy; {new Date().getFullYear()} AgriPump SmartSpace &bull; Enterprise Agricultural IoT &bull; Secured with WhatsApp OTP &amp; TOTP
          </Typography>
        </Box>
      </Box>
    </Box>
  );
};
