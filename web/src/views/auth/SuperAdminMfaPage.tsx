import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Stack,
  Alert,
  Link
} from '@mui/material';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import { useNavigate } from 'react-router-dom';
import { AuthPageLayout } from './AuthPageLayout';
import { OtpInputBoxes } from '../../components/auth/OtpInputBoxes';
import { authService } from '../../api/authService';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

export const SuperAdminMfaPage: React.FC = () => {
  const navigate = useNavigate();
  const { handleAuthResult } = useAuth();
  const { showToast } = useToast();

  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleVerifyMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mfaCode.length !== 6) {
      setError('Please enter all 6 digits from your authenticator app.');
      return;
    }

    setError('');
    setBusy(true);

    try {
      const result = await authService.verifySuperAdminMfa(mfaCode);
      handleAuthResult(result);
      showToast('Super Admin MFA verification complete');
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Incorrect verification code. Please check your authenticator app.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthPageLayout>
      <Box sx={{ width: '100%', maxWidth: 460, mx: 'auto', textAlign: 'center' }}>
        {/* Shield Icon Badge */}
        <Box
          sx={{
            width: 60,
            height: 60,
            borderRadius: '50%',
            bgcolor: '#EFF6FF',
            color: '#2563EB',
            display: 'grid',
            placeItems: 'center',
            mx: 'auto',
            mb: 2.5
          }}
        >
          <ShieldOutlinedIcon sx={{ fontSize: 34 }} />
        </Box>

        {/* Heading & Subtitle */}
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
          Additional verification
        </Typography>
        <Typography variant="body2" sx={{ color: '#64748B', fontSize: '0.94rem', mb: 3 }}>
          Enter the 6-digit code from your authenticator app.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 3, borderRadius: 2, textAlign: 'left' }}>
            {error}
          </Alert>
        )}

        <form onSubmit={handleVerifyMfa}>
          <Stack spacing={3}>
            {/* 6-Digit OTP Boxes */}
            <Box>
              <OtpInputBoxes
                value={mfaCode}
                onChange={val => {
                  setMfaCode(val);
                  if (error) setError('');
                }}
                disabled={busy}
              />
              <Typography sx={{ textAlign: 'center', fontSize: '0.78rem', color: '#64748B', mt: 1 }}>
                Test Authenticator Code: <strong>123456</strong>
              </Typography>
            </Box>

            {/* Verify Button */}
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={busy || mfaCode.length !== 6}
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
              {busy ? 'Verifying...' : 'Verify'}
            </Button>

            {/* Guidance */}
            <Typography variant="body2" sx={{ color: '#64748B', fontSize: '0.86rem' }}>
              Use the code from your configured authenticator app.
            </Typography>

            {/* Back link */}
            <Box sx={{ pt: 1, borderTop: '1px solid #F1F5F9' }}>
              <Link
                component="button"
                type="button"
                variant="body2"
                onClick={() => navigate('/auth/login')}
                sx={{ color: '#64748B', textDecoration: 'none', '&:hover': { color: '#0F172A' } }}
              >
                ← Back to login
              </Link>
            </Box>
          </Stack>
        </form>
      </Box>
    </AuthPageLayout>
  );
};
