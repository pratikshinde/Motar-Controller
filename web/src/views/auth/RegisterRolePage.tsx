import React from 'react';
import {
  Box,
  Typography,
  Card,
  CardActionArea,
  Stack,
  Button
} from '@mui/material';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined';
import SupportAgentOutlinedIcon from '@mui/icons-material/SupportAgentOutlined';
import AgricultureIcon from '@mui/icons-material/Agriculture';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useNavigate } from 'react-router-dom';
import { AuthPageLayout } from './AuthPageLayout';
import type { RoleTier } from '../../types';

export const RegisterRolePage: React.FC = () => {
  const navigate = useNavigate();

  const roleDefinitions: {
    id: RoleTier;
    title: string;
    description: string;
    icon: React.ReactNode;
    bg: string;
    color: string;
    hierarchyNote: string;
  }[] = [
    {
      id: 'superadmin',
      title: 'SUPER ADMIN',
      description: 'Platform administration and global system control.',
      icon: <AdminPanelSettingsOutlinedIcon sx={{ fontSize: 26, color: '#475569' }} />,
      bg: '#F1F5F9',
      color: '#475569',
      hierarchyNote: 'Root Authority &bull; System Provisioned'
    },
    {
      id: 'manufacturer',
      title: 'PANEL MANUFACTURER',
      description: 'Manage panel/device operations and downstream partners.',
      icon: <PrecisionManufacturingIcon sx={{ fontSize: 26, color: '#2563EB' }} />,
      bg: '#EFF6FF',
      color: '#2563EB',
      hierarchyNote: 'Tier 1 Enterprise'
    },
    {
      id: 'distributor',
      title: 'DISTRIBUTOR',
      description: 'Manage dealers, devices and regional operations.',
      icon: <HubOutlinedIcon sx={{ fontSize: 26, color: '#7C3AED' }} />,
      bg: '#F5F3FF',
      color: '#7C3AED',
      hierarchyNote: 'Tier 2 Regional'
    },
    {
      id: 'dealer',
      title: 'DEALER / INSTALLER',
      description: 'Commission devices and support customers.',
      icon: <StorefrontOutlinedIcon sx={{ fontSize: 26, color: '#059669' }} />,
      bg: '#ECFDF5',
      color: '#059669',
      hierarchyNote: 'Tier 3 (L1–L6 Depth)'
    },
    {
      id: 'support',
      title: 'SUPPORT ENGINEER',
      description: 'Diagnostics and technical support.',
      icon: <SupportAgentOutlinedIcon sx={{ fontSize: 26, color: '#D97706' }} />,
      bg: '#FFFBEB',
      color: '#D97706',
      hierarchyNote: 'Operational Support'
    },
    {
      id: 'customer',
      title: 'END USER / FARMER',
      description: 'Access and monitor assigned pump devices.',
      icon: <AgricultureIcon sx={{ fontSize: 26, color: '#059669' }} />,
      bg: '#ECFDF5',
      color: '#059669',
      hierarchyNote: 'Pump Customer'
    }
  ];

  const handleSelectRole = (role: RoleTier) => {
    navigate(`/auth/register/phone?role=${role}`);
  };

  return (
    <AuthPageLayout>
      <Box sx={{ width: '100%', maxWidth: 520, mx: 'auto' }}>
        {/* Header */}
        <Box sx={{ mb: 3 }}>
          <Typography
            variant="h4"
            sx={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 800,
              color: '#0F172A',
              fontSize: { xs: '1.8rem', sm: '2.1rem' },
              letterSpacing: '-0.02em',
              mb: 0.75
            }}
          >
            Create your account
          </Typography>
          <Typography variant="body2" sx={{ color: '#64748B', fontSize: '0.94rem' }}>
            Select the account type you want to create.
          </Typography>
        </Box>

        {/* Roles List */}
        <Stack spacing={1.5} sx={{ mb: 3 }}>
          {roleDefinitions.map(r => (
            <Card
              key={r.id}
              variant="outlined"
              sx={{
                borderRadius: 2.5,
                borderColor: '#E2E8F0',
                bgcolor: '#FFFFFF',
                transition: 'all 0.2s ease',
                '&:hover': {
                  borderColor: '#2563EB',
                  bgcolor: '#F8FAFC',
                  boxShadow: '0 4px 12px rgba(15, 23, 42, 0.05)',
                  transform: 'translateY(-1px)'
                }
              }}
            >
              <CardActionArea
                onClick={() => handleSelectRole(r.id)}
                sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: 2,
                      bgcolor: r.bg,
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0
                    }}
                  >
                    {r.icon}
                  </Box>
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                      <Typography sx={{ fontWeight: 800, fontSize: '0.92rem', color: '#0F172A', letterSpacing: '0.02em' }}>
                        {r.title}
                      </Typography>
                      {r.id === 'superadmin' && (
                        <Box
                          sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 0.5,
                            px: 1,
                            py: 0.2,
                            borderRadius: 1,
                            bgcolor: '#F1F5F9',
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            color: '#64748B'
                          }}
                        >
                          <LockOutlinedIcon sx={{ fontSize: 11 }} /> Controlled
                        </Box>
                      )}
                    </Box>
                    <Typography sx={{ fontSize: '0.82rem', color: '#64748B', lineHeight: 1.35 }}>
                      {r.description}
                    </Typography>
                  </Box>
                </Box>
                <ArrowForwardIcon sx={{ fontSize: 18, color: '#94A3B8', ml: 1, flexShrink: 0 }} />
              </CardActionArea>
            </Card>
          ))}
        </Stack>

        {/* Hierarchy Context Box */}
        <Box sx={{ p: 2, bgcolor: '#F8FAFC', borderRadius: 2, border: '1px solid #E2E8F0', mb: 3 }}>
          <Typography sx={{ fontSize: '0.74rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 0.5 }}>
            Platform Organisation Model:
          </Typography>
          <Typography sx={{ fontSize: '0.78rem', color: '#64748B', lineHeight: 1.4 }}>
            SUPER ADMIN &rarr; MANUFACTURER &rarr; DISTRIBUTOR &rarr; DEALER &rarr; FARMER
          </Typography>
        </Box>

        {/* Already have an account? Sign In */}
        <Box sx={{ pt: 2, borderTop: '1px solid #E2E8F0', textAlign: 'center' }}>
          <Typography variant="body2" sx={{ color: '#64748B' }}>
            Already have an account?{' '}
            <Button
              variant="text"
              onClick={() => navigate('/auth/login')}
              sx={{ fontWeight: 700, color: '#2563EB', textTransform: 'none', p: 0, minWidth: 0, ml: 0.5 }}
            >
              Sign In
            </Button>
          </Typography>
        </Box>
      </Box>
    </AuthPageLayout>
  );
};
