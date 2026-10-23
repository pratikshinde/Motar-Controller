import React, { useState, useEffect } from 'react';
import {
  AppBar,
  Toolbar,
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  useScrollTrigger,
  useTheme,
  Divider,
  Chip
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import LanguageIcon from '@mui/icons-material/Language';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import DashboardIcon from '@mui/icons-material/Dashboard';
import { useNavigate } from 'react-router-dom';
import { BrandLogo } from '../../components/brand/BrandLogo';
import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../context/LocaleContext';
import { supportedLocales, localeLabels, type SupportedLocale } from '../../i18n';

interface LandingNavbarProps {
  onOpenGetStarted: () => void;
}

export const LandingNavbar: React.FC<LandingNavbarProps> = ({ onOpenGetStarted }) => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const { locale, setLocale } = useLocale();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [langAnchor, setLangAnchor] = useState<null | HTMLElement>(null);

  // Trigger for scroll blur & shadow
  const trigger = useScrollTrigger({
    disableHysteresis: true,
    threshold: 20
  });

  const navLinks = [
    { label: 'Home', href: '#hero' },
    { label: 'Features', href: '#features' },
    { label: 'Solutions', href: '#solutions' },
    { label: 'About', href: '#about' },
    { label: 'Support', href: '#support' }
  ];

  const handleScrollTo = (id: string) => {
    setMobileMenuOpen(false);
    const element = document.querySelector(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleLangClick = (event: React.MouseEvent<HTMLElement>) => {
    setLangAnchor(event.currentTarget);
  };

  const handleLangClose = (selected?: SupportedLocale) => {
    setLangAnchor(null);
    if (selected) {
      setLocale(selected);
    }
  };

  return (
    <AppBar
      position="sticky"
      elevation={trigger ? 2 : 0}
      sx={{
        top: 0,
        zIndex: 1100,
        bgcolor: trigger ? 'rgba(255, 255, 255, 0.94)' : 'rgba(255, 255, 255, 0.82)',
        backdropFilter: 'blur(14px)',
        borderBottom: '1px solid',
        borderColor: trigger ? 'rgba(226, 232, 240, 0.9)' : 'rgba(226, 232, 240, 0.4)',
        transition: 'all 0.25s ease-in-out',
        color: '#0F172A'
      }}
    >
      <Toolbar
        sx={{
          maxWidth: 1280,
          width: '100%',
          mx: 'auto',
          px: { xs: 2, sm: 3, md: 4 },
          minHeight: { xs: 64, md: 72 },
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        {/* Left: Brand Logo */}
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <BrandLogo size="medium" onClick={() => handleScrollTo('#hero')} />
        </Box>

        {/* Center: Desktop Navigation Links */}
        <Box
          sx={{
            display: { xs: 'none', md: 'flex' },
            alignItems: 'center',
            gap: { md: 3, lg: 4 }
          }}
        >
          {navLinks.map(link => (
            <Button
              key={link.label}
              onClick={() => handleScrollTo(link.href)}
              sx={{
                color: '#334155',
                fontSize: '0.93rem',
                fontWeight: 600,
                textTransform: 'none',
                px: 1,
                py: 0.5,
                borderRadius: 1.5,
                '&:hover': {
                  color: '#2563EB',
                  bgcolor: 'transparent'
                }
              }}
            >
              {link.label}
            </Button>
          ))}
        </Box>

        {/* Right: Actions */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 1.5 } }}>
          {/* Language Selector */}
          <Button
            size="small"
            onClick={handleLangClick}
            startIcon={<LanguageIcon sx={{ fontSize: 18, color: '#64748B' }} />}
            endIcon={<ArrowDropDownIcon sx={{ fontSize: 18, color: '#64748B' }} />}
            sx={{
              display: { xs: 'none', sm: 'inline-flex' },
              color: '#334155',
              fontSize: '0.85rem',
              fontWeight: 600,
              textTransform: 'none',
              px: 1.25,
              py: 0.5,
              borderRadius: 2,
              border: '1px solid #E2E8F0',
              bgcolor: '#FFFFFF',
              '&:hover': {
                bgcolor: '#F8FAFC',
                borderColor: '#CBD5E1'
              }
            }}
          >
            {locale === 'hi' ? 'हिन्दी' : 'English'}
          </Button>

          <Menu
            anchorEl={langAnchor}
            open={Boolean(langAnchor)}
            onClose={() => handleLangClose()}
            slotProps={{
              paper: {
                sx: {
                  borderRadius: 2,
                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                  minWidth: 140
                }
              }
            }}
          >
            {supportedLocales.map(l => (
              <MenuItem
                key={l}
                selected={locale === l}
                onClick={() => handleLangClose(l)}
                sx={{ fontSize: '0.875rem', fontWeight: locale === l ? 700 : 500 }}
              >
                {localeLabels[l]}
              </MenuItem>
            ))}
          </Menu>

          {/* If already authenticated, show "Dashboard", else "Login". Hidden on a phone: the brand, this button and the menu
              button do not fit side by side below ~420px, and the menu (and the hero) carry the same link. */}
          {isAuthenticated ? (
            <Button
              variant="outlined"
              size="medium"
              startIcon={<DashboardIcon sx={{ fontSize: 18 }} />}
              onClick={() => navigate('/dashboard')}
              sx={{
                display: { xs: 'none', sm: 'inline-flex' },
                textTransform: 'none',
                fontWeight: 700,
                fontSize: '0.88rem',
                borderRadius: 2,
                px: 2,
                py: 0.8,
                color: '#2563EB',
                borderColor: '#93C5FD',
                bgcolor: '#EFF6FF',
                '&:hover': {
                  borderColor: '#2563EB',
                  bgcolor: '#DBEAFE'
                }
              }}
            >
              Dashboard
            </Button>
          ) : (
            <Button
              variant="outlined"
              size="medium"
              onClick={() => navigate('/login')}
              sx={{
                display: { xs: 'none', sm: 'inline-flex' },
                textTransform: 'none',
                fontWeight: 600,
                fontSize: '0.88rem',
                borderRadius: 2,
                px: 2.2,
                py: 0.8,
                color: '#0F172A',
                borderColor: '#CBD5E1',
                bgcolor: '#FFFFFF',
                '&:hover': {
                  borderColor: '#2563EB',
                  color: '#2563EB',
                  bgcolor: '#F8FAFC'
                }
              }}
            >
              Login
            </Button>
          )}

          {/* Primary CTA: Get Started */}
          <Button
            variant="contained"
            size="medium"
            onClick={onOpenGetStarted}
            sx={{
              display: { xs: 'none', sm: 'inline-flex' },
              textTransform: 'none',
              fontWeight: 700,
              fontSize: '0.88rem',
              borderRadius: 2,
              px: 2.5,
              py: 0.85,
              bgcolor: '#2563EB',
              color: '#FFFFFF',
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)',
              '&:hover': {
                bgcolor: '#1D4ED8',
                boxShadow: '0 6px 16px rgba(37, 99, 235, 0.35)'
              }
            }}
          >
            Get Started
          </Button>

          {/* Mobile Hamburger Menu Toggle */}
          <IconButton
            onClick={() => setMobileMenuOpen(true)}
            sx={{
              display: { xs: 'flex', md: 'none' },
              color: '#0F172A',
              ml: 0.5
            }}
            aria-label="Open mobile navigation menu"
          >
            <MenuIcon />
          </IconButton>
        </Box>
      </Toolbar>

      {/* Mobile Drawer Menu */}
      <Drawer
        anchor="right"
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        slotProps={{
          paper: {
            sx: {
              width: 290,
              p: 2.5,
              bgcolor: '#FFFFFF'
            }
          }
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
          <BrandLogo size="small" />
          <IconButton onClick={() => setMobileMenuOpen(false)} size="small">
            <CloseIcon />
          </IconButton>
        </Box>

        <Divider sx={{ mb: 2 }} />

        <List sx={{ px: 0 }}>
          {navLinks.map(link => (
            <ListItem key={link.label} disablePadding>
              <ListItemButton
                onClick={() => handleScrollTo(link.href)}
                sx={{
                  borderRadius: 2,
                  py: 1.25,
                  '&:hover': { bgcolor: '#F1F5F9' }
                }}
              >
                <ListItemText
                  primary={link.label}
                  slotProps={{
                    primary: {
                      sx: {
                        fontWeight: 600,
                        color: '#0F172A',
                        fontSize: '1rem'
                      }
                    }
                  }}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>

        <Divider sx={{ my: 2 }} />

        {/* Mobile Action Buttons */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
          <Button
            variant="contained"
            fullWidth
            onClick={() => {
              setMobileMenuOpen(false);
              onOpenGetStarted();
            }}
            endIcon={<ArrowForwardIcon />}
            sx={{
              bgcolor: '#2563EB',
              color: '#FFFFFF',
              fontWeight: 700,
              py: 1.2,
              borderRadius: 2,
              textTransform: 'none'
            }}
          >
            Get Started
          </Button>

          <Button
            variant="outlined"
            fullWidth
            onClick={() => {
              setMobileMenuOpen(false);
              navigate(isAuthenticated ? '/dashboard' : '/login');
            }}
            sx={{
              color: '#0F172A',
              borderColor: '#CBD5E1',
              fontWeight: 600,
              py: 1.2,
              borderRadius: 2,
              textTransform: 'none'
            }}
          >
            {isAuthenticated ? 'Go to Dashboard' : 'Login'}
          </Button>

          {/* Mobile Language switch */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mt: 2 }}>
            <LanguageIcon sx={{ fontSize: 18, color: '#64748B' }} />
            <Button
              size="small"
              onClick={() => setLocale(locale === 'en' ? 'hi' : 'en')}
              sx={{ color: '#2563EB', fontWeight: 600, textTransform: 'none' }}
            >
              Switch to {locale === 'en' ? 'हिन्दी (Hindi)' : 'English'}
            </Button>
          </Box>
        </Box>
      </Drawer>
    </AppBar>
  );
};
