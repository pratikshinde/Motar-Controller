import React from 'react';
import { Box, Button, Card, CardContent, Container, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import MemoryOutlinedIcon from '@mui/icons-material/MemoryOutlined';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import LoginIcon from '@mui/icons-material/Login';
import { useNavigate } from 'react-router-dom';
import { BrandLogo } from '../../components/brand/BrandLogo';

const GREEN = '#0B7A3E';

const FEATURES = [
  { icon: <GroupsOutlinedIcon />, title: 'People', text: 'Distributors, dealers and farmers under each manufacturer, each with their own dashboard.' },
  { icon: <MemoryOutlinedIcon />, title: 'Devices', text: 'Starters in stock, who they were given to, and which ones are reporting right now.' },
  { icon: <PlaceOutlinedIcon />, title: 'Map', text: 'Where every farmer’s pump is, on one map.' },
  { icon: <NotificationsActiveOutlinedIcon />, title: 'Alerts', text: 'Faults and pumps that stopped reporting, as they happen.' }
];

/** The first page of the website: what it is, a Login button for everyone, and a lock icon in the header that opens the platform owner's sign-in. */
export const HomeView: React.FC = () => {
  const navigate = useNavigate();
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#FFFFFF', color: '#0F172A', display: 'flex', flexDirection: 'column' }}>
      <Box component="header" sx={{ borderBottom: '1px solid #E2E8F0', bgcolor: '#FFFFFF', position: 'sticky', top: 0, zIndex: 10 }}>
        <Container maxWidth="lg" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.5 }}>
          <BrandLogo size="medium" partnerName="Pump Controller" />
          <Tooltip title="Platform owner sign in">
            <IconButton
              aria-label="Platform owner sign in"
              data-testid="owner-lock"
              onClick={() => navigate('/owner')}
              sx={{ border: '1px solid #E2E8F0', color: '#334155', '&:hover': { bgcolor: '#F1F5F9' } }}
            >
              <LockOutlinedIcon />
            </IconButton>
          </Tooltip>
        </Container>
      </Box>

      <Box component="main" sx={{ flex: 1 }}>
        <Box sx={{ background: 'linear-gradient(180deg, #F0FDF4 0%, #FFFFFF 100%)', py: { xs: 7, md: 11 } }}>
          <Container maxWidth="md" sx={{ textAlign: 'center' }}>
            <Typography
              component="h1"
              sx={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, letterSpacing: '-0.02em', fontSize: { xs: '2.1rem', md: '3.2rem' }, lineHeight: 1.1, mb: 2 }}
            >
              Every pump, <Box component="span" sx={{ color: GREEN }}>one website</Box>
            </Typography>
            <Typography sx={{ color: '#475569', fontSize: { xs: '1rem', md: '1.15rem' }, maxWidth: 620, mx: 'auto', mb: 4, lineHeight: 1.6 }}>
              Manufacturers, distributors and dealers see and look after their farmers’ pumps in one place: who has which starter, whether it is running, and what needs attention.
            </Typography>
            <Button
              data-testid="login-button"
              variant="contained"
              size="large"
              startIcon={<LoginIcon />}
              onClick={() => navigate('/login')}
              sx={{ bgcolor: GREEN, px: 5, py: 1.4, borderRadius: 2.5, fontWeight: 700, fontSize: '1.05rem', textTransform: 'none', boxShadow: '0 6px 16px rgba(11, 122, 62, 0.28)', '&:hover': { bgcolor: '#08642F' } }}
            >
              Login
            </Button>
            <Typography sx={{ color: '#64748B', fontSize: '0.88rem', mt: 2 }}>For admins, distributors and dealers.</Typography>
          </Container>
        </Box>

        <Container maxWidth="lg" sx={{ py: { xs: 5, md: 8 } }}>
          <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' } }}>
            {FEATURES.map(f => (
              <Card key={f.title} variant="outlined" sx={{ borderRadius: 3, borderColor: '#E2E8F0' }}>
                <CardContent sx={{ p: 3 }}>
                  <Box sx={{ width: 44, height: 44, borderRadius: 2, bgcolor: '#E4F5EA', color: GREEN, display: 'grid', placeItems: 'center', mb: 1.5 }}>{f.icon}</Box>
                  <Typography sx={{ fontWeight: 700, mb: 0.5 }}>{f.title}</Typography>
                  <Typography sx={{ color: '#64748B', fontSize: '0.9rem', lineHeight: 1.5 }}>{f.text}</Typography>
                </CardContent>
              </Card>
            ))}
          </Box>

          <Card variant="outlined" sx={{ mt: 4, borderRadius: 3, borderColor: '#BBF7D0', bgcolor: '#F0FDF4' }} data-testid="farmers-note">
            <CardContent sx={{ p: 3 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
                <PhoneAndroidIcon sx={{ color: GREEN, fontSize: 34 }} />
                <Box>
                  <Typography sx={{ fontWeight: 700 }}>Are you a farmer?</Typography>
                  <Typography sx={{ color: '#475569', fontSize: '0.92rem' }}>
                    Farmers use the mobile app, not this website. Ask your dealer for your QR code and scan it in the app.
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Container>
      </Box>

      <Box component="footer" sx={{ borderTop: '1px solid #E2E8F0', py: 3, textAlign: 'center' }}>
        <Typography sx={{ fontSize: '0.8rem', color: '#94A3B8' }}>&copy; {new Date().getFullYear()} Pump Controller</Typography>
      </Box>
    </Box>
  );
};
