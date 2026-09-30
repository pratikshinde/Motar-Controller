import React from 'react';
import { Box, Typography, Grid, Chip } from '@mui/material';
import MonitorHeartOutlinedIcon from '@mui/icons-material/MonitorHeartOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import GroupWorkOutlinedIcon from '@mui/icons-material/GroupWorkOutlined';
import SensorsIcon from '@mui/icons-material/Sensors';
import HandshakeOutlinedIcon from '@mui/icons-material/HandshakeOutlined';
import VerifiedUserOutlinedIcon from '@mui/icons-material/VerifiedUserOutlined';
import { useNavigate } from 'react-router-dom';
import { BrandLogo } from '../../components/brand/BrandLogo';

export const AuthHeroPanel: React.FC = () => {
  const navigate = useNavigate();

  const capabilities = [
    {
      title: 'Real-time Monitoring',
      desc: 'Live pump status, voltage, current and runtime',
      icon: <MonitorHeartOutlinedIcon sx={{ fontSize: 22, color: '#059669' }} />,
      bg: '#ECFDF5'
    },
    {
      title: 'Remote Control',
      desc: 'Start/Stop and cyclic timers',
      icon: <TuneOutlinedIcon sx={{ fontSize: 22, color: '#2563EB' }} />,
      bg: '#EFF6FF'
    },
    {
      title: 'Instant Alerts',
      desc: 'Get notified on faults and critical events',
      icon: <NotificationsActiveOutlinedIcon sx={{ fontSize: 22, color: '#DC2626' }} />,
      bg: '#FEF2F2'
    },
    {
      title: 'Fleet Management',
      desc: 'Manage devices, dealers, RMA and subscriptions',
      icon: <GroupWorkOutlinedIcon sx={{ fontSize: 22, color: '#7C3AED' }} />,
      bg: '#F5F3FF'
    }
  ];

  return (
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
        bgcolor: '#0B1528',
        color: '#FFFFFF'
      }}
    >
      {/* Background image & gradient overlay */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'url(/hero-agripump.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center right',
          opacity: 0.28,
          filter: 'brightness(0.95)',
          zIndex: 0
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(135deg, rgba(11,21,40,0.94) 0%, rgba(11,21,40,0.85) 60%, rgba(15,23,42,0.92) 100%)',
          zIndex: 1
        }}
      />

      {/* Top: Brand Header */}
      <Box sx={{ position: 'relative', zIndex: 2, mb: { xs: 3, md: 4 } }}>
        <Box sx={{ display: 'inline-block', cursor: 'pointer' }} onClick={() => navigate('/')}>
          <BrandLogo size="medium" light withTagline />
        </Box>
      </Box>

      {/* Center: Main Headings & Capabilities */}
      <Box sx={{ position: 'relative', zIndex: 2, my: 'auto', py: { xs: 2, md: 3 } }}>
        <Typography
          variant="h2"
          sx={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 800,
            fontSize: { xs: '2rem', sm: '2.5rem', lg: '3rem' },
            lineHeight: 1.15,
            letterSpacing: '-0.02em',
            color: '#FFFFFF',
            mb: 2
          }}
        >
          Powering <br />
          Smarter Agriculture <br />
          <Box component="span" sx={{ color: '#38BDF8' }}>
            with IoT
          </Box>
        </Typography>

        <Typography
          sx={{
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            fontSize: { xs: '0.95rem', sm: '1.05rem' },
            lineHeight: 1.6,
            color: '#CBD5E1',
            maxWidth: 520,
            mb: { xs: 3.5, md: 4.5 }
          }}
        >
          Monitor, control and manage your agricultural pump systems from anywhere. Built for
          farmers, dealers, manufacturers and support teams.
        </Typography>

        {/* 2x2 Capabilities Grid */}
        <Grid container spacing={2} sx={{ maxWidth: 540 }}>
          {capabilities.map((item, idx) => (
            <Grid size={{ xs: 12, sm: 6 }} key={idx}>
              <Box
                sx={{
                  p: 2,
                  borderRadius: 2.5,
                  bgcolor: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  backdropFilter: 'blur(8px)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 1.5,
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    bgcolor: 'rgba(255, 255, 255, 0.08)',
                    borderColor: 'rgba(255, 255, 255, 0.2)'
                  }
                }}
              >
                <Box
                  sx={{
                    width: 38,
                    height: 38,
                    borderRadius: 2,
                    bgcolor: item.bg,
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0
                  }}
                >
                  {item.icon}
                </Box>
                <Box>
                  <Typography sx={{ fontWeight: 700, fontSize: '0.88rem', color: '#FFFFFF', mb: 0.25, lineHeight: 1.2 }}>
                    {item.title}
                  </Typography>
                  <Typography sx={{ fontSize: '0.76rem', color: '#94A3B8', lineHeight: 1.35 }}>
                    {item.desc}
                  </Typography>
                </Box>
              </Box>
            </Grid>
          ))}
        </Grid>
      </Box>

      {/* Bottom: Metrics Strip */}
      <Box
        sx={{
          position: 'relative',
          zIndex: 2,
          mt: { xs: 3, md: 4 },
          pt: 2.5,
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          alignItems: 'center',
          gap: { xs: 2.5, sm: 4 },
          flexWrap: 'wrap'
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <SensorsIcon sx={{ color: '#38BDF8', fontSize: 22 }} />
          <Box>
            <Typography sx={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, fontSize: '1.05rem', color: '#FFFFFF', lineHeight: 1.1 }}>
              10,000+
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: '#94A3B8' }}>Connected Pumps</Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <HandshakeOutlinedIcon sx={{ color: '#34D399', fontSize: 22 }} />
          <Box>
            <Typography sx={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, fontSize: '1.05rem', color: '#FFFFFF', lineHeight: 1.1 }}>
              100+
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: '#94A3B8' }}>Channel Partners</Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <VerifiedUserOutlinedIcon sx={{ color: '#34D399', fontSize: 22 }} />
          <Box>
            <Typography sx={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, fontSize: '1.05rem', color: '#FFFFFF', lineHeight: 1.1 }}>
              99.9%
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: '#94A3B8' }}>Reliable &amp; Secure</Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};
