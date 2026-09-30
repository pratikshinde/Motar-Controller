import React, { useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Stack,
  Alert,
  InputAdornment,
  Divider,
  Chip
} from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useNavigate } from 'react-router-dom';
import { AuthPageLayout } from './AuthPageLayout';
import { WhatsAppIcon } from '../../components/auth/WhatsAppIcon';
import { authService, sanitizePhone } from '../../api/authService';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const demoAccounts = [
    { label: 'Super Admin', phone: '9999900001', role: 'Super Admin' },
    { label: 'Manufacturer', phone: '9999900002', role: 'OEM' },
    { label: 'Distributor', phone: '9999900003', role: 'Regional' },
    { label: 'Dealer', phone: '9999900004', role: 'Installer' },
    { label: 'Support', phone: '9999900005', role: 'Engineer' },
    { label: 'Farmer', phone: '9999900006', role: 'Customer' }
  ];

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);

    try {
      const res = await authService.sendWhatsAppOtp(phone);
      navigate('/auth/verify-otp', { state: { devOtp: res.dev_otp } });
    } catch (err: any) {
      setError(err.message || 'Could not dispatch WhatsApp OTP');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthPageLayout>
      <Box sx={{ width: '100%', maxWidth: 460, mx: 'auto' }}>
        {/* Heading */}
        <Box sx={{ mb: 3.5 }}>
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
            Welcome back
          </Typography>
          <Typography variant="body2" sx={{ color: '#64748B', fontSize: '0.94rem' }}>
            Sign in to AgriPump SmartSpace
          </Typography>
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
                placeholder="Enter your mobile number"
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

            {/* Primary Action Button: Send WhatsApp OTP */}
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

            {/* WhatsApp Communication note */}
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
                We&apos;ll send a secure OTP to your WhatsApp number.
              </Typography>
            </Box>
          </Stack>
        </form>

        {/* Quick Demo Role Picker for Testing */}
        <Box sx={{ mt: 3.5, p: 2, bgcolor: '#F8FAFC', borderRadius: 2.5, border: '1px solid #E2E8F0' }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748B', mb: 1, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Quick Test Accounts (Click to test role):
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {demoAccounts.map(acc => (
              <Chip
                key={acc.phone}
                label={`${acc.label} (${acc.role})`}
                size="small"
                onClick={() => setPhone(acc.phone)}
                sx={{
                  bgcolor: phone === acc.phone ? '#EFF6FF' : '#FFFFFF',
                  borderColor: phone === acc.phone ? '#2563EB' : '#CBD5E1',
                  color: phone === acc.phone ? '#2563EB' : '#334155',
                  fontWeight: 600,
                  fontSize: '0.74rem',
                  border: '1px solid',
                  cursor: 'pointer',
                  '&:hover': { bgcolor: '#F1F5F9' }
                }}
              />
            ))}
          </Box>
        </Box>

        {/* Switch to Create Account */}
        <Box sx={{ mt: 3.5, pt: 2.5, borderTop: '1px solid #E2E8F0', textAlign: 'center' }}>
          <Typography variant="body2" sx={{ color: '#64748B' }}>
            Don&apos;t have an account?{' '}
            <Button
              variant="text"
              onClick={() => navigate('/auth/register')}
              endIcon={<ArrowForwardIcon sx={{ fontSize: 16 }} />}
              sx={{ fontWeight: 700, color: '#2563EB', textTransform: 'none', p: 0, minWidth: 0, ml: 0.5 }}
            >
              Create Account
            </Button>
          </Typography>
        </Box>
      </Box>
    </AuthPageLayout>
  );
};
