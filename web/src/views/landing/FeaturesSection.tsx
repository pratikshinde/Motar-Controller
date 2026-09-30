import React, { useState } from 'react';
import {
  Box,
  Container,
  Typography,
  Grid,
  Card,
  CardContent,
  Chip,
  Tabs,
  Tab
} from '@mui/material';
import SpeedIcon from '@mui/icons-material/Speed';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import ElectricMeterIcon from '@mui/icons-material/ElectricMeter';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import HandymanOutlinedIcon from '@mui/icons-material/HandymanOutlined';
import AssignmentTurnedInOutlinedIcon from '@mui/icons-material/AssignmentTurnedInOutlined';
import BarChartIcon from '@mui/icons-material/BarChart';
import SecurityIcon from '@mui/icons-material/Security';

export const FeaturesSection: React.FC = () => {
  const [activeTab, setActiveTab] = useState(0);

  const allFeatures = [
    {
      title: 'Live Pump Monitoring',
      category: 'operations',
      desc: 'Real-time telemetry showing 3-phase voltage (RY, YB, BR), load current per phase, power factor, and live running state.',
      icon: <SpeedIcon sx={{ fontSize: 28, color: '#059669' }} />,
      bg: '#ECFDF5',
      badge: 'Real-time'
    },
    {
      title: 'Remote START / STOP',
      category: 'operations',
      desc: 'Instant zero-lag control over cellular networks with auto-restart scheduling and star-delta starter interlock safety.',
      icon: <PowerSettingsNewIcon sx={{ fontSize: 28, color: '#2563EB' }} />,
      bg: '#EFF6FF',
      badge: 'Zero-Lag'
    },
    {
      title: 'Intelligent Fault Detection',
      category: 'protection',
      desc: 'Immediate trip detection for dry run, phase failure, reverse phase, high/low voltage, and motor overload conditions.',
      icon: <WarningAmberIcon sx={{ fontSize: 28, color: '#DC2626' }} />,
      bg: '#FEF2F2',
      badge: 'Auto-Trip'
    },
    {
      title: 'Instant Alerts & Broadcasts',
      category: 'protection',
      desc: 'Instant push notifications, SMS alerts, and WebSocket live updates to protect pumps before motor burnout occurs.',
      icon: <NotificationsActiveIcon sx={{ fontSize: 28, color: '#D97706' }} />,
      bg: '#FFFBEB',
      badge: 'Instant SMS'
    },
    {
      title: 'Device Registry & Inventory',
      category: 'fleet',
      desc: 'Complete tracking of hardware IMEI, ICCID, 4G SIM connectivity, supply type, and active warranty timestamps.',
      icon: <Inventory2OutlinedIcon sx={{ fontSize: 28, color: '#4F46E5' }} />,
      bg: '#EEF2FF',
      badge: 'Registry'
    },
    {
      title: 'Hierarchical Device Allocation',
      category: 'fleet',
      desc: 'Multi-tenant delegation from OEM manufacturer to regional distributors, local dealers, and end-user farmers.',
      icon: <AccountTreeOutlinedIcon sx={{ fontSize: 28, color: '#7C3AED' }} />,
      bg: '#F5F3FF',
      badge: 'Multi-Tenant'
    },
    {
      title: 'Firmware & FOTA Management',
      category: 'fleet',
      desc: 'Safe over-the-air firmware updates with cryptographic checksum validation, phased rollouts, and rollback support.',
      icon: <SystemUpdateAltIcon sx={{ fontSize: 28, color: '#2563EB' }} />,
      bg: '#EFF6FF',
      badge: 'FOTA'
    },
    {
      title: 'Dealer Commissioning Tools',
      category: 'management',
      desc: 'Mobile-assisted hardware commissioning, cellular signal RSSI testing, and on-field customer account handover.',
      icon: <HandymanOutlinedIcon sx={{ fontSize: 28, color: '#059669' }} />,
      bg: '#ECFDF5',
      badge: 'Field Tool'
    },
    {
      title: 'RMA & Warranty Tracking',
      category: 'management',
      desc: 'Comprehensive return merchandise authorization lifecycles, service logs, hardware replacement, and repair history.',
      icon: <AssignmentTurnedInOutlinedIcon sx={{ fontSize: 28, color: '#0891B2' }} />,
      bg: '#ECFEFF',
      badge: 'Service'
    },
    {
      title: 'Energy & Run Analytics',
      category: 'analytics',
      desc: 'Historical pump runtime charts, estimated power consumption (kWh), water discharge trends, and power cut logs.',
      icon: <BarChartIcon sx={{ fontSize: 28, color: '#2563EB' }} />,
      bg: '#EFF6FF',
      badge: 'Insights'
    },
    {
      title: 'Comprehensive Device Telemetry',
      category: 'analytics',
      desc: 'High-frequency telemetry recording voltage fluctuations, current spikes, power factor trends, and signal strength.',
      icon: <ElectricMeterIcon sx={{ fontSize: 28, color: '#059669' }} />,
      bg: '#ECFDF5',
      badge: 'Telemetry'
    },
    {
      title: 'Audit Logs & System Monitoring',
      category: 'management',
      desc: 'Immutable audit logs of all user actions, command dispatches, MQTT broker status, and infrastructure health metrics.',
      icon: <SecurityIcon sx={{ fontSize: 28, color: '#D97706' }} />,
      bg: '#FFFBEB',
      badge: 'Enterprise'
    }
  ];

  const categories = ['all', 'operations', 'protection', 'fleet', 'management', 'analytics'];
  const categoryLabels = ['All Capabilities', 'Operations', 'Protection', 'Fleet IoT', 'Management', 'Analytics'];

  const filteredFeatures =
    activeTab === 0
      ? allFeatures
      : allFeatures.filter(f => f.category === categories[activeTab]);

  return (
    <Box
      id="features"
      sx={{
        py: { xs: 8, md: 11 },
        bgcolor: '#FFFFFF'
      }}
    >
      <Container maxWidth="xl" sx={{ px: { xs: 2.5, sm: 4, md: 5 } }}>
        {/* Header */}
        <Box sx={{ textAlign: 'center', maxWidth: 760, mx: 'auto', mb: { xs: 5, md: 6 } }}>
          <Chip
            label="PLATFORM CAPABILITIES"
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
              fontSize: { xs: '2rem', sm: '2.6rem', md: '3rem' },
              color: '#0F172A',
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
              mb: 2
            }}
          >
            Powering Smarter Pump Operations
          </Typography>
          <Typography
            sx={{
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              fontSize: { xs: '0.98rem', sm: '1.08rem' },
              color: '#64748B',
              lineHeight: 1.6
            }}
          >
            From electrical motor protection and remote cellular switching to multi-tier dealer management
            and over-the-air firmware updates — every layer is engineered for industrial agriculture.
          </Typography>

          {/* Filter Tabs */}
          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center' }}>
            <Tabs
              value={activeTab}
              onChange={(_, val) => setActiveTab(val)}
              variant="scrollable"
              scrollButtons="auto"
              allowScrollButtonsMobile
              sx={{
                '& .MuiTabs-indicator': { bgcolor: '#2563EB', height: 3, borderRadius: 1.5 },
                '& .MuiTab-root': {
                  textTransform: 'none',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  minWidth: 'auto',
                  px: 2,
                  color: '#64748B',
                  '&.Mui-selected': { color: '#2563EB', fontWeight: 700 }
                }
              }}
            >
              {categoryLabels.map((lbl, i) => (
                <Tab key={i} label={lbl} />
              ))}
            </Tabs>
          </Box>
        </Box>

        {/* Feature Cards Grid */}
        <Grid container spacing={3}>
          {filteredFeatures.map((feat, idx) => (
            <Grid size={{ xs: 12, sm: 6, lg: 4 }} key={idx}>
              <Card
                variant="outlined"
                elevation={0}
                sx={{
                  height: '100%',
                  borderRadius: 3,
                  borderColor: '#E2E8F0',
                  bgcolor: '#FFFFFF',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'all 0.25s ease-in-out',
                  '&:hover': {
                    borderColor: '#93C5FD',
                    boxShadow: '0 12px 28px -6px rgba(37, 99, 235, 0.12)',
                    transform: 'translateY(-3px)'
                  }
                }}
              >
                <CardContent sx={{ p: 3, display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
                    <Box
                      sx={{
                        width: 52,
                        height: 52,
                        borderRadius: 2.5,
                        bgcolor: feat.bg,
                        display: 'grid',
                        placeItems: 'center'
                      }}
                    >
                      {feat.icon}
                    </Box>
                    <Chip
                      label={feat.badge}
                      size="small"
                      sx={{
                        fontWeight: 700,
                        fontSize: '0.72rem',
                        color: '#475569',
                        bgcolor: '#F1F5F9',
                        borderRadius: 1.5
                      }}
                    />
                  </Box>

                  <Typography
                    variant="h6"
                    sx={{
                      fontSize: '1.18rem',
                      fontWeight: 700,
                      color: '#0F172A',
                      mb: 1.25,
                      lineHeight: 1.3
                    }}
                  >
                    {feat.title}
                  </Typography>

                  <Typography
                    variant="body2"
                    sx={{
                      fontSize: '0.9rem',
                      color: '#64748B',
                      lineHeight: 1.55,
                      flexGrow: 1
                    }}
                  >
                    {feat.desc}
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
