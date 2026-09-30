import React, { useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Stack,
  Alert,
  InputAdornment,
  Link
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AuthPageLayout } from './AuthPageLayout';
import { WhatsAppIcon } from '../../components/auth/WhatsAppIcon';
import { authService } from '../../api/authService';
import type { RoleTier } from '../../types';

export const RegisterPhonePage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const role = (searchParams.get('role') as RoleTier) || 'dealer';

  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const roleLabels: Record<RoleTier, string> = {
    superadmin: 'Super Admin',
    manufacturer: 'Panel Manufacturer',
    distributor: 'Distributor',
    dealer: 'Dealer / Installer',
    support: 'Support Engineer',
    customer: 'End User / Farmer'
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);

    try {
      const res = await authService.sendWhatsAppOtp(phone, { isRegistration: true, role });
      navigate(`/auth/register/verify?role=${role}`, { state: { devOtp: res.dev_otp } });
    } catch (err: any) {
      setError(err.message || 'Could not send WhatsApp OTP.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthPageLayout>
      <Box sx={{ width: '100%', maxWidth: 460, mx: 'auto' }}>
        {/* Back to Role Selection */}
        <Button
          size="small"
          onClick={() => navigate('/auth/register')}
          startIcon={<ArrowBackIcon sx={{ fontSize: 16 }} />}
          sx={{ mb: 2, color: '#64748B', fontWeight: 600, textTransform: 'none' }}
        >
          ← Change account type
        </Button>

        {/* Heading */}
        <Box sx={{ mb: 3 }}>
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
            Create your account
          </Typography>

          {/* Selected Role Badge */}
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 1,
              px: 1.75,
              py: 0.5,
              borderRadius: 1.5,
              bgcolor: '#EFF6FF',
              border: '1px solid #BFDBFE',
              mt: 0.5
            }}
          >
            <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, color: '#1E40AF' }}>
              Role: {roleLabels[role] || 'Dealer / Installer'}
            </Typography>
          </Box>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
            {error}
          </Alert>
        )}

        <form onSubmit={handleSendOtp}>
          <Stack spacing={2.5}>
            {/* Mobile Number input with +91 country selector */}
            <Box>
              <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155', mb: 0.75 }}>
                Mobile Number
              </Typography>
              <TextField
                placeholder="Enter mobile number"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                fullWidth
                required
                type="tel"
                autoFocus
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pr: 1.25, borderRight: '1px solid #CBD5E1' }}>
                          <span style={{ fontSize: '1.1rem' }}>🇮🇳</span>
                          <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, color: '#0F172A' }}>
                            +91
                          </Typography>
                        </Box>
                      </InputAdornment>
                    ),
                    sx: {
                      borderRadius: 2.2,
                      bgcolor: '#FFFFFF',
                      fontSize: '1rem',
                      color: '#0F172A !important',
                      '& input': {
                        color: '#0F172A !important',
                        WebkitTextFillColor: '#0F172A !important',
                        fontWeight: 600
                      }
                    }
                  }
                }}
              />
            </Box>

            {/* Submit Button */}
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={busy || !phone.trim()}
              startIcon={<WhatsAppIcon sx={{ fontSize: 22 }} />}
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
              {busy ? 'Sending OTP...' : 'Send WhatsApp OTP'}
            </Button>

            {/* Note */}
            <Box
              sx={{
                p: 1.75,
                borderRadius: 2,
                bgcolor: '#F0FDF4',
                border: '1px solid #BBF7D0',
                display: 'flex',
                alignItems: 'center',
                gap: 1.25
              }}
            >
              <WhatsAppIcon sx={{ color: '#16A34A', fontSize: 20, flexShrink: 0 }} />
              <Typography sx={{ fontSize: '0.84rem', color: '#166534', fontWeight: 500, lineHeight: 1.4 }}>
                We&apos;ll send a secure OTP to your WhatsApp number to verify your identity.
              </Typography>
            </Box>
          </Stack>
        </form>

        {/* Link to Login */}
        <Box sx={{ mt: 4, pt: 2.5, borderTop: '1px solid #E2E8F0', textAlign: 'center' }}>
          <Typography variant="body2" sx={{ color: '#64748B' }}>
            Already have an account?{' '}
            <Link
              component="button"
              type="button"
              variant="body2"
              onClick={() => navigate('/auth/login')}
              sx={{ fontWeight: 700, color: '#2563EB', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
            >
              Sign In
            </Link>
          </Typography>
        </Box>
      </Box>
    </AuthPageLayout>
  );
};
