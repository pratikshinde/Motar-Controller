import React from 'react';
import { Box, Typography, Grid } from '@mui/material';
import MonitorHeartOutlinedIcon from '@mui/icons-material/MonitorHeartOutlined';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import PersonAddAlt1OutlinedIcon from '@mui/icons-material/PersonAddAlt1Outlined';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import SensorsIcon from '@mui/icons-material/Sensors';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import { BrandLogo } from '../../components/brand/BrandLogo';

// The Ajanta palette: deep green (the land), water blue (the pump), sun amber (a warning). The same three colours as the farmer's app.
const CAPABILITIES = [
  { title: 'Live monitoring', body: 'Voltage, current, run time and signal for every pump.', icon: MonitorHeartOutlinedIcon, tint: '#34C37A' },
  { title: 'Faults in plain words', body: "The starter's own fault name, the moment it happens.", icon: ReportProblemOutlinedIcon, tint: '#FBBF24' },
  { title: 'Register a farmer', body: 'Add the farmer, give the starter, hand over one QR code.', icon: PersonAddAlt1OutlinedIcon, tint: '#38B6F5' },
  { title: 'Start and stop', body: 'Switch a pump on or off from anywhere, with a safe cooldown.', icon: PowerSettingsNewIcon, tint: '#34C37A' }
];

const FACTS = [
  { label: '4G connected pumps', icon: SensorsIcon, tint: '#38B6F5' },
  { label: 'Secure, encrypted sign-in', icon: LockOutlinedIcon, tint: '#34C37A' },
  { label: 'Farmers use the mobile app', icon: PhoneAndroidIcon, tint: '#FBBF24' }
];

export const AuthHeroPanel: React.FC = () => (
  <Box
    sx={{
      height: '100%',
      minHeight: { xs: 'auto', md: '100vh' },
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      p: { xs: 3, sm: 5, lg: 6 },
      position: 'relative',
      overflow: 'hidden',
      bgcolor: '#06251A',
      color: '#FFFFFF'
    }}
  >
    {/* Background image and the green wash over it */}
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        backgroundImage: 'url(/hero-agripump.jpg)',
        backgroundSize: 'cover',
        backgroundPosition: 'center right',
        opacity: 0.22,
        zIndex: 0
      }}
    />
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        background:
          'radial-gradient(ellipse 70% 50% at 85% 8%, rgba(56,182,245,0.20), transparent 60%), linear-gradient(145deg, rgba(6,37,26,0.96) 0%, rgba(8,52,34,0.90) 55%, rgba(6,30,22,0.96) 100%)',
        zIndex: 1
      }}
    />

    <Box sx={{ position: 'relative', zIndex: 2, mb: { xs: 3, md: 4 } }}>
      <BrandLogo size="medium" light partnerName="Pump Controller" />
    </Box>

    <Box sx={{ position: 'relative', zIndex: 2, my: 'auto', py: { xs: 2, md: 3 } }}>
      <Typography
        variant="h2"
        sx={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, fontSize: { xs: '2rem', sm: '2.5rem', lg: '3rem' }, lineHeight: 1.12, letterSpacing: '-0.02em', color: '#FFFFFF', mb: 2 }}
      >
        Every pump.
        <br />
        Every farmer.
        <br />
        <Box component="span" sx={{ color: '#7CD0FF' }}>
          One place.
        </Box>
      </Typography>

      <Typography sx={{ fontSize: { xs: '0.95rem', sm: '1.05rem' }, lineHeight: 1.6, color: '#C9DDD2', maxWidth: 500, mb: { xs: 3.5, md: 4.5 } }}>
        Register farmers, watch each pump live and know about a fault the moment it happens.
      </Typography>

      <Grid container spacing={1.75} sx={{ maxWidth: 560 }}>
        {CAPABILITIES.map(c => {
          const Icon = c.icon;
          return (
            <Grid key={c.title} size={{ xs: 12, sm: 6 }}>
              <Box
                sx={{
                  display: 'flex',
                  gap: 1.5,
                  p: 1.75,
                  height: '100%',
                  borderRadius: 3,
                  bgcolor: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  transition: 'all 0.2s ease',
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.09)', borderColor: 'rgba(255,255,255,0.22)' }
                }}
              >
                <Box sx={{ width: 40, height: 40, flexShrink: 0, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: 'rgba(255,255,255,0.08)' }}>
                  <Icon sx={{ fontSize: 22, color: c.tint }} />
                </Box>
                <Box>
                  <Typography sx={{ fontWeight: 700, fontSize: '0.9rem', color: '#FFFFFF', lineHeight: 1.2, mb: 0.25 }}>{c.title}</Typography>
                  <Typography sx={{ fontSize: '0.78rem', color: '#A9C2B4', lineHeight: 1.4 }}>{c.body}</Typography>
                </Box>
              </Box>
            </Grid>
          );
        })}
      </Grid>
    </Box>

    <Box
      sx={{
        position: 'relative',
        zIndex: 2,
        display: 'flex',
        flexWrap: 'wrap',
        gap: { xs: 2, sm: 4 },
        pt: 3,
        borderTop: '1px solid rgba(255,255,255,0.12)'
      }}
    >
      {FACTS.map(f => {
        const Icon = f.icon;
        return (
          <Box key={f.label} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Icon sx={{ color: f.tint, fontSize: 20 }} />
            <Typography sx={{ fontSize: '0.8rem', color: '#C9DDD2', fontWeight: 600 }}>{f.label}</Typography>
          </Box>
        );
      })}
    </Box>
  </Box>
);
