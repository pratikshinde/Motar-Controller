import React from 'react';
import {
  Box,
  Typography,
  Button,
  Stack,
  Paper,
  Divider
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircle';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useNavigate, useLocation } from 'react-router-dom';
import { AuthPageLayout } from './AuthPageLayout';
import { authService } from '../../api/authService';
import { useAuth } from '../../context/AuthContext';
import type { RoleTier, User } from '../../types';

export const RegisterSuccessPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { handleAuthResult } = useAuth();

  const state = (location.state as { role?: RoleTier; phone?: string; user?: User }) || {};
  const role = state.role || 'dealer';
  const phone = state.phone || '+91 99999 00004';

  const roleLabels: Record<RoleTier, string> = {
    superadmin: 'Super Admin',
    manufacturer: 'Panel Manufacturer',
    distributor: 'Regional Distributor',
    dealer: 'Dealer / Installer',
    support: 'Support Engineer',
    customer: 'End User / Farmer'
  };

  const handleContinueDashboard = () => {
    // If not already in session, create session
    const current = authService.getCurrentUser();
    if (current) {
      handleAuthResult({
        token: `token_${Date.now()}`,
        refreshToken: `refresh_${Date.now()}`,
        user: current
      });
    }
    navigate('/dashboard');
  };

  return (
    <AuthPageLayout showBackHome={false}>
      <Box sx={{ width: '100%', maxWidth: 460, mx: 'auto', textAlign: 'center' }}>
        {/* Success Icon */}
        <Box
          sx={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            bgcolor: '#ECFDF5',
            color: '#059669',
            display: 'grid',
            placeItems: 'center',
            mx: 'auto',
            mb: 2.5
          }}
        >
          <CheckCircleOutlineIcon sx={{ fontSize: 40 }} />
        </Box>

        {/* Heading */}
        <Typography
          variant="h4"
          sx={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 800,
            color: '#0F172A',
            fontSize: { xs: '1.75rem', sm: '2rem' },
            letterSpacing: '-0.02em',
            mb: 0.75
          }}
        >
          Account created successfully
        </Typography>
        <Typography variant="body2" sx={{ color: '#64748B', fontSize: '0.94rem', mb: 3.5 }}>
          Your AgriPump SmartSpace account is ready.
        </Typography>

        {/* Details Card */}
        <Paper
          variant="outlined"
          sx={{
            p: 3,
            borderRadius: 3,
            bgcolor: '#F8FAFC',
            borderColor: '#E2E8F0',
            textAlign: 'left',
            mb: 3.5
          }}
        >
          <Stack spacing={1.75}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography sx={{ fontSize: '0.84rem', color: '#64748B' }}>Account Type</Typography>
              <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, color: '#0F172A' }}>
                {roleLabels[role] || 'Dealer / Installer'}
              </Typography>
            </Box>

            <Divider />

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography sx={{ fontSize: '0.84rem', color: '#64748B' }}>Registered Phone</Typography>
              <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, color: '#0F172A' }}>
                {phone}
              </Typography>
            </Box>

            <Divider />

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography sx={{ fontSize: '0.84rem', color: '#64748B' }}>Platform Status</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#10B981' }} />
                <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, color: '#059669' }}>
                  ACTIVE
                </Typography>
              </Box>
            </Box>
          </Stack>
        </Paper>

        {/* Primary Action Button */}
        <Stack spacing={1.5}>
          <Button
            variant="contained"
            size="large"
            onClick={handleContinueDashboard}
            endIcon={<ArrowForwardIcon />}
            sx={{
              py: 1.4,
              borderRadius: 2.2,
              fontWeight: 700,
              fontSize: '0.98rem',
              bgcolor: '#2563EB',
              textTransform: 'none',
              boxShadow: '0 4px 14px rgba(37, 99, 235, 0.28)',
              '&:hover': { bgcolor: '#1D4ED8' }
            }}
          >
            Continue to Dashboard
          </Button>

          <Button
            variant="text"
            onClick={() => navigate('/auth/login')}
            sx={{
              color: '#64748B',
              fontWeight: 600,
              fontSize: '0.88rem',
              textTransform: 'none'
            }}
          >
            Go to Login
          </Button>
        </Stack>
      </Box>
    </AuthPageLayout>
  );
};
