import React from 'react';
import { Box, Container, Typography, Grid, Chip } from '@mui/material';
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing';
import CellTowerIcon from '@mui/icons-material/CellTower';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import DevicesIcon from '@mui/icons-material/Devices';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';

export const ArchitectureVisual: React.FC = () => {
  const steps = [
    {
      step: '01',
      title: 'SMART PUMP',
      subtitle: 'Field Hardware',
      desc: 'Agricultural pump starter panel with digital energy metering, contactor controls, and multi-parameter motor sensors.',
      icon: <PrecisionManufacturingIcon sx={{ fontSize: 30, color: '#059669' }} />,
      color: '#059669',
      bgColor: '#ECFDF5',
      tech: 'Star-Delta • RS-485 Modbus'
    },
    {
      step: '02',
      title: 'IoT / 4G CONNECTIVITY',
      subtitle: 'Secure Edge Gateway',
      desc: 'Industrial cellular modem providing resilient data transmission, buffer queuing on weak networks, and TLS-encrypted MQTT.',
      icon: <CellTowerIcon sx={{ fontSize: 30, color: '#2563EB' }} />,
      color: '#2563EB',
      bgColor: '#EFF6FF',
      tech: '4G LTE Cat-1 • MQTT / TLS'
    },
    {
      step: '03',
      title: 'CLOUD PLATFORM',
      subtitle: 'Scalable Core',
      desc: 'AWS IoT Core and high-speed telemetry engine providing fault evaluation, multi-tenant state handling, and automated push alerts.',
      icon: <CloudQueueIcon sx={{ fontSize: 30, color: '#7C3AED' }} />,
      color: '#7C3AED',
      bgColor: '#F5F3FF',
      tech: 'AWS IoT • Real-time Rule Engine'
    },
    {
      step: '04',
      title: 'WEB & MOBILE APPS',
      subtitle: 'Unified Applications',
      desc: 'Responsive web control console for manufacturers and dealers, plus intuitive vernacular mobile app for farmers.',
      icon: <DevicesIcon sx={{ fontSize: 30, color: '#0284C7' }} />,
      color: '#0284C7',
      bgColor: '#F0F9FF',
      tech: 'Web Dashboard • Farmer App'
    }
  ];

  return (
    <Box
      id="architecture"
      sx={{
        py: { xs: 8, md: 11 },
        bgcolor: '#FFFFFF'
      }}
    >
      <Container maxWidth="xl" sx={{ px: { xs: 2.5, sm: 4, md: 5 } }}>
        <Box sx={{ textAlign: 'center', maxWidth: 740, mx: 'auto', mb: { xs: 6, md: 8 } }}>
          <Chip
            label="CONNECTED ARCHITECTURE"
            sx={{
              fontWeight: 800,
              fontSize: '0.72rem',
              letterSpacing: '0.08em',
              color: '#2563EB',
              bgcolor: '#EFF6FF',
              mb: 2,
              borderRadius: 1.5
            }}
          />
          <Typography
            variant="h2"
            sx={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 800,
              fontSize: { xs: '2rem', sm: '2.5rem', md: '3rem' },
              color: '#0F172A',
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
              mb: 2
            }}
          >
            From Field to Cloud to Screen
          </Typography>
          <Typography
            sx={{
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              fontSize: { xs: '0.98rem', sm: '1.08rem' },
              color: '#64748B',
              lineHeight: 1.6
            }}
          >
            A high-reliability communication pipeline purpose-built to withstand erratic rural power
            and cellular conditions.
          </Typography>
        </Box>

        {/* Pipeline Container */}
        <Grid container spacing={3} sx={{ alignItems: 'stretch' }}>
          {steps.map((item, idx) => (
            <React.Fragment key={idx}>
              <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
                <Box
                  sx={{
                    height: '100%',
                    p: 3.5,
                    borderRadius: 3.5,
                    bgcolor: '#FFFFFF',
                    border: '1px solid #E2E8F0',
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                    transition: 'all 0.25s ease',
                    boxShadow: '0 4px 6px -1px rgba(15, 23, 42, 0.04)',
                    '&:hover': {
                      borderColor: item.color,
                      boxShadow: '0 12px 24px -6px rgba(15, 23, 42, 0.08)',
                      transform: 'translateY(-3px)'
                    }
                  }}
                >
                  {/* Top Step Pill & Icon */}
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
                    <Box
                      sx={{
                        width: 54,
                        height: 54,
                        borderRadius: 2.5,
                        bgcolor: item.bgColor,
                        display: 'grid',
                        placeItems: 'center'
                      }}
                    >
                      {item.icon}
                    </Box>
                    <Typography
                      sx={{
                        fontFamily: "'Space Grotesk', sans-serif",
                        fontWeight: 800,
                        fontSize: '1.1rem',
                        color: '#CBD5E1'
                      }}
                    >
                      {item.step}
                    </Typography>
                  </Box>

                  <Typography
                    variant="overline"
                    sx={{
                      fontWeight: 800,
                      color: item.color,
                      fontSize: '0.72rem',
                      letterSpacing: '0.08em',
                      lineHeight: 1.2
                    }}
                  >
                    {item.subtitle}
                  </Typography>

                  <Typography
                    variant="h6"
                    sx={{
                      fontWeight: 800,
                      color: '#0F172A',
                      fontSize: '1.1rem',
                      mb: 1.25,
                      lineHeight: 1.3
                    }}
                  >
                    {item.title}
                  </Typography>

                  <Typography
                    variant="body2"
                    sx={{
                      color: '#64748B',
                      fontSize: '0.88rem',
                      lineHeight: 1.55,
                      mb: 2.5,
                      flexGrow: 1
                    }}
                  >
                    {item.desc}
                  </Typography>

                  {/* Tech specs tag */}
                  <Box
                    sx={{
                      pt: 2,
                      borderTop: '1px solid #F1F5F9',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                  >
                    <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>
                      {item.tech}
                    </Typography>
                  </Box>
                </Box>
              </Grid>
            </React.Fragment>
          ))}
        </Grid>
      </Container>
    </Box>
  );
};
