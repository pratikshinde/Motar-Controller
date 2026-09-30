import React from 'react';
import { Box, Container, Grid, Typography, Card, CardContent } from '@mui/material';
import MonitorHeartOutlinedIcon from '@mui/icons-material/MonitorHeartOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import GroupWorkOutlinedIcon from '@mui/icons-material/GroupWorkOutlined';
import SecurityOutlinedIcon from '@mui/icons-material/SecurityOutlined';

export const CapabilityStrip: React.FC = () => {
  const capabilities = [
    {
      title: 'Real-time Monitoring',
      description: 'Live voltage, current, runtime and device status',
      icon: <MonitorHeartOutlinedIcon sx={{ fontSize: 26, color: '#059669' }} />,
      iconBg: '#ECFDF5',
      badgeColor: '#059669'
    },
    {
      title: 'Remote Control',
      description: 'Start / Stop, configuration and cyclic timers',
      icon: <TuneOutlinedIcon sx={{ fontSize: 26, color: '#2563EB' }} />,
      iconBg: '#EFF6FF',
      badgeColor: '#2563EB'
    },
    {
      title: 'Instant Alerts',
      description: 'Get notified on faults and critical events',
      icon: <NotificationsActiveOutlinedIcon sx={{ fontSize: 26, color: '#DC2626' }} />,
      iconBg: '#FEF2F2',
      badgeColor: '#DC2626'
    },
    {
      title: 'Fleet Management',
      description: 'Manage devices, dealers, RMA and subscriptions',
      icon: <GroupWorkOutlinedIcon sx={{ fontSize: 26, color: '#7C3AED' }} />,
      iconBg: '#F5F3FF',
      badgeColor: '#7C3AED'
    },
    {
      title: 'Secure & Scalable',
      description: 'Built on AWS with enterprise-grade security',
      icon: <SecurityOutlinedIcon sx={{ fontSize: 26, color: '#D97706' }} />,
      iconBg: '#FFFBEB',
      badgeColor: '#D97706'
    }
  ];

  return (
    <Box
      sx={{
        py: { xs: 4, sm: 5 },
        bgcolor: '#F8FAFC',
        borderTop: '1px solid #E2E8F0',
        borderBottom: '1px solid #E2E8F0'
      }}
    >
      <Container maxWidth="xl" sx={{ px: { xs: 2.5, sm: 4, md: 5 } }}>
        <Grid container spacing={2}>
          {capabilities.map((item, idx) => (
            <Grid size={{ xs: 12, sm: 6, md: 2.4 }} key={idx}>
              <Card
                variant="outlined"
                elevation={0}
                sx={{
                  height: '100%',
                  bgcolor: '#FFFFFF',
                  borderRadius: 3,
                  borderColor: '#E2E8F0',
                  boxShadow: '0 2px 4px rgba(15, 23, 42, 0.02)',
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    borderColor: '#CBD5E1',
                    boxShadow: '0 8px 16px -4px rgba(15, 23, 42, 0.06)',
                    transform: 'translateY(-2px)'
                  }
                }}
              >
                <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
                  <Box
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: 2.5,
                      bgcolor: item.iconBg,
                      display: 'grid',
                      placeItems: 'center',
                      mb: 2
                    }}
                  >
                    {item.icon}
                  </Box>
                  <Typography
                    variant="h6"
                    sx={{
                      fontSize: '1rem',
                      fontWeight: 700,
                      color: '#0F172A',
                      mb: 0.75,
                      lineHeight: 1.25
                    }}
                  >
                    {item.title}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      fontSize: '0.85rem',
                      color: '#64748B',
                      lineHeight: 1.45
                    }}
                  >
                    {item.description}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Container>
    </Box>
  );
};
