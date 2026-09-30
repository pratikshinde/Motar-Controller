import React from 'react';
import {
  Box,
  Container,
  Grid,
  Typography,
  Button,
  Stack,
  useTheme,
  useMediaQuery
} from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import SensorsIcon from '@mui/icons-material/Sensors';
import HandshakeOutlinedIcon from '@mui/icons-material/HandshakeOutlined';
import VerifiedUserOutlinedIcon from '@mui/icons-material/VerifiedUserOutlined';
import CircleIcon from '@mui/icons-material/Circle';
import { useNavigate } from 'react-router-dom';

interface HeroSectionProps {
  onOpenGetStarted: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({ onOpenGetStarted }) => {
  const theme = useTheme();
  const navigate = useNavigate();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const metrics = [
    {
      value: '10,000+',
      label: 'Connected Pumps',
      icon: <SensorsIcon sx={{ color: '#2563EB', fontSize: 24 }} />
    },
    {
      value: '100+',
      label: 'Channel Partners',
      icon: <HandshakeOutlinedIcon sx={{ color: '#059669', fontSize: 24 }} />
    },
    {
      value: '99.9%',
      label: 'Reliable & Secure',
      icon: <VerifiedUserOutlinedIcon sx={{ color: '#059669', fontSize: 24 }} />
    }
  ];

  return (
    <Box
      id="hero"
      sx={{
        position: 'relative',
        overflow: 'hidden',
        pt: { xs: 5, sm: 7, md: 8 },
        pb: { xs: 6, sm: 8, md: 9 },
        bgcolor: '#FFFFFF',
        backgroundImage: `
          radial-gradient(circle at 15% 25%, rgba(37, 99, 235, 0.05) 0%, transparent 45%),
          radial-gradient(circle at 85% 75%, rgba(5, 150, 105, 0.04) 0%, transparent 45%)
        `
      }}
    >
      <Container maxWidth="xl" sx={{ px: { xs: 2.5, sm: 4, md: 5 } }}>
        <Grid container spacing={{ xs: 4, md: 5 }} sx={{ alignItems: 'center' }}>
          {/* Left Column: Headlines & CTA */}
          <Grid size={{ xs: 12, md: 6, lg: 5.5 }}>
            <Box sx={{ maxWidth: 620 }}>
              {/* Eyebrow Pill */}
              <Box
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 1.25,
                  px: 1.75,
                  py: 0.65,
                  borderRadius: 99,
                  bgcolor: '#F1F5F9',
                  border: '1px solid #E2E8F0',
                  mb: { xs: 2.5, sm: 3 }
                }}
              >
                <Typography
                  sx={{
                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                    fontSize: { xs: '0.68rem', sm: '0.74rem' },
                    fontWeight: 700,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: '#475569'
                  }}
                >
                  SMART PUMPS &bull; HEALTHY FARMS &bull; SUSTAINABLE TOMORROW
                </Typography>
              </Box>

              {/* Main Headline */}
              <Typography
                component="h1"
                sx={{
                  fontFamily: "'Space Grotesk', 'Plus Jakarta Sans', sans-serif",
                  fontSize: { xs: '2.5rem', sm: '3.4rem', md: '3.8rem', lg: '4.2rem' },
                  fontWeight: 800,
                  lineHeight: { xs: 1.12, md: 1.08 },
                  letterSpacing: '-0.03em',
                  color: '#0F172A',
                  mb: { xs: 2.5, sm: 3 }
                }}
              >
                Connect. Monitor. <br />
                Control.{' '}
                <Box
                  component="span"
                  sx={{
                    color: '#2563EB',
                    position: 'relative',
                    display: 'inline-block'
                  }}
                >
                  Grow.
                </Box>
              </Typography>

              {/* Supporting Subtitle */}
              <Typography
                sx={{
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                  fontSize: { xs: '1rem', sm: '1.125rem' },
                  lineHeight: 1.65,
                  color: '#475569',
                  mb: { xs: 3.5, sm: 4.5 },
                  maxWidth: 540
                }}
              >
                AgriPump SmartSpace is a complete IoT platform for agricultural pump controllers,
                enabling real-time monitoring, remote control, fault alerts and fleet management —
                built for farmers, dealers and manufacturers.
              </Typography>

              {/* CTA Buttons */}
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={2}
                sx={{ mb: { xs: 4, sm: 5, md: 6 } }}
              >
                <Button
                  variant="contained"
                  size="large"
                  onClick={onOpenGetStarted}
                  endIcon={<ArrowForwardIcon />}
                  sx={{
                    bgcolor: '#2563EB',
                    color: '#FFFFFF',
                    fontWeight: 700,
                    fontSize: '1rem',
                    textTransform: 'none',
                    borderRadius: 2.5,
                    px: 3.5,
                    py: 1.5,
                    boxShadow: '0 10px 25px -5px rgba(37, 99, 235, 0.35)',
                    '&:hover': {
                      bgcolor: '#1D4ED8',
                      boxShadow: '0 14px 30px -5px rgba(37, 99, 235, 0.45)'
                    }
                  }}
                >
                  Get Started →
                </Button>

                <Button
                  variant="outlined"
                  size="large"
                  onClick={() => navigate('/login')}
                  sx={{
                    color: '#0F172A',
                    borderColor: '#CBD5E1',
                    bgcolor: '#FFFFFF',
                    fontWeight: 700,
                    fontSize: '1rem',
                    textTransform: 'none',
                    borderRadius: 2.5,
                    px: 3.5,
                    py: 1.5,
                    borderWidth: 1.5,
                    '&:hover': {
                      borderColor: '#2563EB',
                      color: '#2563EB',
                      bgcolor: '#F8FAFC',
                      borderWidth: 1.5
                    }
                  }}
                >
                  Login
                </Button>
              </Stack>

              {/* Trust / Metric Strip */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: { xs: 2.5, sm: 4, md: 4.5 },
                  flexWrap: 'wrap',
                  pt: 2.5,
                  borderTop: '1px solid #E2E8F0'
                }}
              >
                {metrics.map((item, index) => (
                  <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box
                      sx={{
                        width: 44,
                        height: 44,
                        borderRadius: 2,
                        bgcolor: index === 0 ? '#EFF6FF' : '#ECFDF5',
                        display: 'grid',
                        placeItems: 'center',
                        flexShrink: 0
                      }}
                    >
                      {item.icon}
                    </Box>
                    <Box>
                      <Typography
                        sx={{
                          fontFamily: "'Space Grotesk', sans-serif",
                          fontWeight: 800,
                          fontSize: { xs: '1.15rem', sm: '1.25rem' },
                          color: '#0F172A',
                          lineHeight: 1.1
                        }}
                      >
                        {item.value}
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: '0.78rem',
                          color: '#64748B',
                          fontWeight: 600,
                          lineHeight: 1.3
                        }}
                      >
                        {item.label}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </Grid>

          {/* Right Column: Visual Composition */}
          <Grid size={{ xs: 12, md: 6, lg: 6.5 }}>
            <Box
              sx={{
                position: 'relative',
                width: '100%',
                borderRadius: { xs: 3, md: 4 },
                overflow: 'hidden',
                boxShadow: '0 20px 45px -12px rgba(15, 23, 42, 0.15)',
                border: '1px solid rgba(226, 232, 240, 0.9)',
                bgcolor: '#F8FAFC'
              }}
            >
              {/* Composite Image showing farm, flowing water, smart pump panel, laptop dashboard & phone app */}
              <Box
                component="img"
                src="/hero-agripump.jpg"
                alt="AgriPump SmartSpace IoT Platform - Field pump, telemetry dashboard and mobile application"
                sx={{
                  width: '100%',
                  height: 'auto',
                  display: 'block',
                  transform: 'scale(1.01)',
                  transition: 'transform 0.5s ease-out',
                  '&:hover': {
                    transform: 'scale(1.025)'
                  }
                }}
              />

              {/* Floating Live Telemetry Badge (Top Left of image on larger screens) */}
              <Box
                sx={{
                  position: 'absolute',
                  top: { xs: 12, sm: 20 },
                  left: { xs: 12, sm: 20 },
                  bgcolor: 'rgba(15, 23, 42, 0.85)',
                  backdropFilter: 'blur(8px)',
                  color: '#FFFFFF',
                  px: 1.75,
                  py: 0.85,
                  borderRadius: 2,
                  boxShadow: '0 8px 20px rgba(0, 0, 0, 0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  border: '1px solid rgba(255, 255, 255, 0.12)'
                }}
              >
                <CircleIcon sx={{ color: '#10B981', fontSize: 10, animation: 'pulse 1.8s infinite' }} />
                <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.04em' }}>
                  FLEET LIVE: 95.7% ONLINE &bull; 415 V &bull; 50 Hz
                </Typography>
              </Box>

              {/* Bottom Right Floating Badge (Pump running state) */}
              <Box
                sx={{
                  position: 'absolute',
                  bottom: { xs: 12, sm: 20 },
                  right: { xs: 12, sm: 20 },
                  bgcolor: 'rgba(255, 255, 255, 0.92)',
                  backdropFilter: 'blur(10px)',
                  color: '#0F172A',
                  px: 1.75,
                  py: 1,
                  borderRadius: 2,
                  boxShadow: '0 10px 25px rgba(0, 0, 0, 0.15)',
                  display: { xs: 'none', sm: 'flex' },
                  alignItems: 'center',
                  gap: 1.2,
                  border: '1px solid rgba(226, 232, 240, 0.8)'
                }}
              >
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    bgcolor: '#059669',
                    boxShadow: '0 0 8px #10B981'
                  }}
                />
                <Box>
                  <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: '#0F172A', lineHeight: 1.1 }}>
                    Borewell Pump #01
                  </Typography>
                  <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: '#059669' }}>
                    Running &bull; 12.4 A &bull; Power Factor 0.88
                  </Typography>
                </Box>
              </Box>
            </Box>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
};
