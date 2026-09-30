import React from 'react';
import { Box, Container, Grid, Typography, Link, Stack, Divider } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { BrandLogo } from '../../components/brand/BrandLogo';

export const Footer: React.FC = () => {
  const navigate = useNavigate();

  const handleNav = (path: string) => {
    navigate(path);
  };

  return (
    <Box
      id="support"
      component="footer"
      sx={{
        bgcolor: '#070E1B',
        color: '#94A3B8',
        pt: { xs: 8, md: 10 },
        pb: 5,
        borderTop: '1px solid rgba(255, 255, 255, 0.08)'
      }}
    >
      <Container maxWidth="xl" sx={{ px: { xs: 2.5, sm: 4, md: 5 } }}>
        <Grid container spacing={{ xs: 4, md: 6 }}>
          {/* Brand info */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Box sx={{ mb: 2.5 }}>
              <BrandLogo size="medium" light withTagline />
            </Box>
            <Typography variant="body2" sx={{ color: '#64748B', maxWidth: 360, lineHeight: 1.6, mb: 3 }}>
              Enterprise IoT platform engineered for agricultural pump controllers, smart starters,
              and multi-tier irrigation fleet operations across rural grids.
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#10B981' }} />
              <Typography sx={{ fontSize: '0.78rem', color: '#10B981', fontWeight: 600 }}>
                All Platform Systems Operational
              </Typography>
            </Box>
          </Grid>

          {/* Platform Links */}
          <Grid size={{ xs: 6, sm: 3, md: 2 }}>
            <Typography variant="subtitle2" sx={{ color: '#FFFFFF', fontWeight: 700, mb: 2, fontSize: '0.92rem' }}>
              Platform
            </Typography>
            <Stack spacing={1.2}>
              <Link
                component="button"
                onClick={() => handleNav('/dashboard')}
                sx={{ color: '#94A3B8', textDecoration: 'none', textAlign: 'left', fontSize: '0.86rem', '&:hover': { color: '#38BDF8' } }}
              >
                Dashboard
              </Link>
              <Link
                component="button"
                onClick={() => handleNav('/devices')}
                sx={{ color: '#94A3B8', textDecoration: 'none', textAlign: 'left', fontSize: '0.86rem', '&:hover': { color: '#38BDF8' } }}
              >
                Devices
              </Link>
              <Link
                component="button"
                onClick={() => handleNav('/alerts')}
                sx={{ color: '#94A3B8', textDecoration: 'none', textAlign: 'left', fontSize: '0.86rem', '&:hover': { color: '#38BDF8' } }}
              >
                Alerts
              </Link>
              <Link
                component="button"
                onClick={() => handleNav('/factory')}
                sx={{ color: '#94A3B8', textDecoration: 'none', textAlign: 'left', fontSize: '0.86rem', '&:hover': { color: '#38BDF8' } }}
              >
                Firmware
              </Link>
              <Link
                component="button"
                onClick={() => handleNav('/service-reports')}
                sx={{ color: '#94A3B8', textDecoration: 'none', textAlign: 'left', fontSize: '0.86rem', '&:hover': { color: '#38BDF8' } }}
              >
                Reports
              </Link>
            </Stack>
          </Grid>

          {/* Solutions Links */}
          <Grid size={{ xs: 6, sm: 3, md: 2 }}>
            <Typography variant="subtitle2" sx={{ color: '#FFFFFF', fontWeight: 700, mb: 2, fontSize: '0.92rem' }}>
              Solutions
            </Typography>
            <Stack spacing={1.2}>
              <Link
                href="#solutions"
                sx={{ color: '#94A3B8', textDecoration: 'none', fontSize: '0.86rem', '&:hover': { color: '#38BDF8' } }}
              >
                Farmers
              </Link>
              <Link
                href="#solutions"
                sx={{ color: '#94A3B8', textDecoration: 'none', fontSize: '0.86rem', '&:hover': { color: '#38BDF8' } }}
              >
                Dealers
              </Link>
              <Link
                href="#solutions"
                sx={{ color: '#94A3B8', textDecoration: 'none', fontSize: '0.86rem', '&:hover': { color: '#38BDF8' } }}
              >
                Manufacturers
              </Link>
            </Stack>
          </Grid>

          {/* Support Links */}
          <Grid size={{ xs: 6, sm: 3, md: 2 }}>
            <Typography variant="subtitle2" sx={{ color: '#FFFFFF', fontWeight: 700, mb: 2, fontSize: '0.92rem' }}>
              Support
            </Typography>
            <Stack spacing={1.2}>
              <Link
                component="button"
                onClick={() => handleNav('/support')}
                sx={{ color: '#94A3B8', textDecoration: 'none', textAlign: 'left', fontSize: '0.86rem', '&:hover': { color: '#38BDF8' } }}
              >
                Support Console
              </Link>
              <Link
                component="button"
                onClick={() => handleNav('/health')}
                sx={{ color: '#94A3B8', textDecoration: 'none', textAlign: 'left', fontSize: '0.86rem', '&:hover': { color: '#38BDF8' } }}
              >
                System Health
              </Link>
              <Link
                href="mailto:support@agripump.io"
                sx={{ color: '#94A3B8', textDecoration: 'none', fontSize: '0.86rem', '&:hover': { color: '#38BDF8' } }}
              >
                Contact
              </Link>
            </Stack>
          </Grid>

          {/* Legal Links */}
          <Grid size={{ xs: 6, sm: 3, md: 2 }}>
            <Typography variant="subtitle2" sx={{ color: '#FFFFFF', fontWeight: 700, mb: 2, fontSize: '0.92rem' }}>
              Legal
            </Typography>
            <Stack spacing={1.2}>
              <Typography sx={{ color: '#64748B', fontSize: '0.86rem' }}>
                Privacy Policy
              </Typography>
              <Typography sx={{ color: '#64748B', fontSize: '0.86rem' }}>
                Terms of Service
              </Typography>
              <Typography sx={{ color: '#64748B', fontSize: '0.86rem' }}>
                Security Architecture
              </Typography>
            </Stack>
          </Grid>
        </Grid>

        <Divider sx={{ my: 4, borderColor: 'rgba(255, 255, 255, 0.08)' }} />

        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 2
          }}
        >
          <Typography sx={{ fontSize: '0.82rem', color: '#64748B' }}>
            &copy; {new Date().getFullYear()} AgriPump SmartSpace. All rights reserved.
          </Typography>
          <Typography sx={{ fontSize: '0.82rem', color: '#64748B' }}>
            Precision Agricultural IoT &bull; Built for Rural Reliability
          </Typography>
        </Box>
      </Container>
    </Box>
  );
};
