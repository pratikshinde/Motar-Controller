import React from 'react';
import {
  Box,
  Container,
  Typography,
  Grid,
  Card,
  CardContent,
  Chip,
  Button,
  List,
  ListItem,
  ListItemIcon,
  ListItemText
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AgricultureIcon from '@mui/icons-material/Agriculture';
import HandymanIcon from '@mui/icons-material/Handyman';
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';

interface SolutionsSectionProps {
  onOpenGetStarted: () => void;
}

export const SolutionsSection: React.FC<SolutionsSectionProps> = ({ onOpenGetStarted }) => {
  const solutions = [
    {
      title: 'FARMERS',
      subtitle: 'Effortless remote irrigation and motor protection',
      desc: 'Monitor pumps, view status, receive alerts and remotely control pumps directly from the mobile app or voice/SMS.',
      icon: <AgricultureIcon sx={{ fontSize: 32, color: '#059669' }} />,
      accentColor: '#059669',
      bgColor: '#ECFDF5',
      points: [
        'Turn pumps ON/OFF safely without traveling to fields at night',
        'Automatic motor trip on dry run, low voltage, or phase loss',
        'Multi-lingual voice alerts and regional language support',
        'Real-time water run timer and power availability notifications'
      ]
    },
    {
      title: 'DEALERS / INSTALLERS',
      subtitle: 'Streamlined field commissioning and service management',
      desc: 'Commission devices, configure pumps, perform diagnostics and manage customer devices with rapid technician tools.',
      icon: <HandymanIcon sx={{ fontSize: 32, color: '#2563EB' }} />,
      accentColor: '#2563EB',
      bgColor: '#EFF6FF',
      points: [
        'Fast QR code commissioning & cellular signal strength diagnostics',
        'Configure overload amps, dry run trip delays, and timer presets',
        'Manage subordinate farmer installations across your territory',
        'Track RMA warranty tickets, service claims, and replacements'
      ]
    },
    {
      title: 'MANUFACTURERS / DISTRIBUTORS',
      subtitle: 'Complete fleet oversight, FOTA and channel governance',
      desc: 'Manage device fleets, allocation, firmware, organisations, alerts and operational visibility from a single enterprise console.',
      icon: <PrecisionManufacturingIcon sx={{ fontSize: 32, color: '#7C3AED' }} />,
      accentColor: '#7C3AED',
      bgColor: '#F5F3FF',
      points: [
        'Batch allocation of device hardware to distributors and dealers',
        'Over-the-air firmware (FOTA) releases with canary rollouts',
        'White-label partner branding and multi-tier tenant hierarchy',
        'Fleet-wide reliability metrics, fault trends, and audit trails'
      ]
    }
  ];

  return (
    <Box
      id="solutions"
      sx={{
        py: { xs: 8, md: 11 },
        bgcolor: '#F8FAFC',
        borderTop: '1px solid #E2E8F0',
        borderBottom: '1px solid #E2E8F0'
      }}
    >
      <Container maxWidth="xl" sx={{ px: { xs: 2.5, sm: 4, md: 5 } }}>
        <Box sx={{ textAlign: 'center', maxWidth: 720, mx: 'auto', mb: { xs: 5, md: 7 } }}>
          <Chip
            label="TAILORED SOLUTIONS"
            sx={{
              fontWeight: 800,
              fontSize: '0.72rem',
              letterSpacing: '0.08em',
              color: '#059669',
              bgcolor: '#ECFDF5',
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
            Built for Every Stakeholder
          </Typography>
          <Typography
            sx={{
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              fontSize: { xs: '0.98rem', sm: '1.08rem' },
              color: '#64748B',
              lineHeight: 1.6
            }}
          >
            A unified IoT ecosystem connecting the farm field, the local service technician, and the
            manufacturing enterprise.
          </Typography>
        </Box>

        <Grid container spacing={3.5}>
          {solutions.map((item, idx) => (
            <Grid size={{ xs: 12, md: 4 }} key={idx}>
              <Card
                variant="outlined"
                elevation={0}
                sx={{
                  height: '100%',
                  bgcolor: '#FFFFFF',
                  borderRadius: 3.5,
                  borderColor: '#E2E8F0',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'all 0.25s ease',
                  '&:hover': {
                    borderColor: item.accentColor,
                    boxShadow: '0 16px 32px -8px rgba(15, 23, 42, 0.08)',
                    transform: 'translateY(-4px)'
                  }
                }}
              >
                <CardContent sx={{ p: { xs: 3, sm: 4 }, display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <Box
                    sx={{
                      width: 60,
                      height: 60,
                      borderRadius: 3,
                      bgcolor: item.bgColor,
                      display: 'grid',
                      placeItems: 'center',
                      mb: 2.5
                    }}
                  >
                    {item.icon}
                  </Box>

                  <Typography
                    variant="overline"
                    sx={{
                      fontWeight: 800,
                      color: item.accentColor,
                      fontSize: '0.75rem',
                      letterSpacing: '0.08em',
                      mb: 0.5
                    }}
                  >
                    {item.title}
                  </Typography>

                  <Typography
                    variant="h5"
                    sx={{
                      fontWeight: 700,
                      color: '#0F172A',
                      fontSize: '1.25rem',
                      mb: 1.25,
                      lineHeight: 1.3
                    }}
                  >
                    {item.subtitle}
                  </Typography>

                  <Typography
                    variant="body2"
                    sx={{
                      color: '#64748B',
                      fontSize: '0.92rem',
                      lineHeight: 1.55,
                      mb: 3
                    }}
                  >
                    {item.desc}
                  </Typography>

                  <List sx={{ p: 0, mb: 3.5, flexGrow: 1 }}>
                    {item.points.map((pt, pIdx) => (
                      <ListItem key={pIdx} disableGutters sx={{ alignItems: 'flex-start', py: 0.75 }}>
                        <ListItemIcon sx={{ minWidth: 28, mt: '2px' }}>
                          <CheckCircleIcon sx={{ fontSize: 18, color: item.accentColor }} />
                        </ListItemIcon>
                        <ListItemText
                          primary={pt}
                          slotProps={{
                            primary: {
                              sx: {
                                fontSize: '0.86rem',
                                color: '#334155',
                                lineHeight: 1.45,
                                fontWeight: 500
                              }
                            }
                          }}
                        />
                      </ListItem>
                    ))}
                  </List>

                  <Button
                    variant="outlined"
                    fullWidth
                    onClick={onOpenGetStarted}
                    endIcon={<ArrowForwardIcon />}
                    sx={{
                      color: '#0F172A',
                      borderColor: '#E2E8F0',
                      borderRadius: 2,
                      py: 1.15,
                      fontWeight: 700,
                      textTransform: 'none',
                      fontSize: '0.88rem',
                      '&:hover': {
                        borderColor: item.accentColor,
                        bgcolor: item.bgColor,
                        color: item.accentColor
                      }
                    }}
                  >
                    Get Started for {item.title}
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Container>
    </Box>
  );
};
