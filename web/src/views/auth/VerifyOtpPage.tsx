import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Stack,
  Alert,
  Link
} from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { useNavigate, useLocation } from 'react-router-dom';
import { AuthPageLayout } from './AuthPageLayout';
import { OtpInputBoxes } from '../../components/auth/OtpInputBoxes';
import { WhatsAppIcon } from '../../components/auth/WhatsAppIcon';
import { authService } from '../../api/authService';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

export const VerifyOtpPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { handleAuthResult } = useAuth();
  const { showToast } = useToast();

  const flowState = authService.getFlowState();
  const [otp, setOtp] = useState('');
  const [timerSeconds, setTimerSeconds] = useState(28);
  const [canResend, setCanResend] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // If page was reached without phone in flowState, redirect back to login
  useEffect(() => {
    if (!flowState.phone) {
      navigate('/auth/login', { replace: true });
    }
  }, [flowState.phone, navigate]);

  // Resend Countdown Timer (00:28)
  useEffect(() => {
    if (timerSeconds <= 0) {
      setCanResend(true);
      return;
    }
    const timer = setInterval(() => {
      setTimerSeconds(prev => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [timerSeconds]);

  const handleResend = async () => {
    if (!canResend) return;
    setError('');
    setBusy(true);
    try {
      await authService.sendWhatsAppOtp(flowState.phone);
      setTimerSeconds(28);
      setCanResend(false);
      setOtp('');
      showToast('A new OTP has been dispatched to WhatsApp.');
    } catch (err: any) {
      setError(err.message || 'Failed to resend OTP.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 6) {
      setError('Please enter all 6 digits of the OTP.');
      return;
    }
    setError('');
    setBusy(true);

    try {
      const outcome = await authService.verifyWhatsAppOtp(flowState.phone, otp);

      // Super Admin: Additional Authenticator MFA Step Required
      if (outcome.requiresMfa) {
        showToast('WhatsApp verified. Please enter Authenticator code.');
        navigate('/auth/mfa');
        return;
      }

      // All other roles: Authenticated!
      if (outcome.authResult) {
        handleAuthResult(outcome.authResult);
        showToast(`Authenticated as ${outcome.authResult.user.full_name}`);
        navigate('/dashboard');
      }
    } catch (err: any) {
      setError(err.message || 'Incorrect OTP. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const formatTimer = (secs: number) => {
    const s = secs < 10 ? `0${secs}` : `${secs}`;
    return `00:${s}`;
  };

  return (
    <AuthPageLayout>
      <Box sx={{ width: '100%', maxWidth: 460, mx: 'auto' }}>
        {/* Header */}
        <Box sx={{ mb: 3.5, textAlign: 'center' }}>
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              bgcolor: '#F0FDF4',
              color: '#16A34A',
              display: 'grid',
              placeItems: 'center',
              mx: 'auto',
              mb: 2
            }}
          >
            <WhatsAppIcon sx={{ fontSize: 32 }} />
          </Box>
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
            Verify your number
          </Typography>
          <Typography variant="body2" sx={{ color: '#64748B', fontSize: '0.94rem' }}>
            We&apos;ve sent a 6-digit OTP to your WhatsApp:
          </Typography>

          {/* Masked Phone Badge */}
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 1,
              mt: 1.5,
              px: 2,
              py: 0.6,
              borderRadius: 99,
              bgcolor: '#F1F5F9',
              border: '1px solid #E2E8F0'
            }}
          >
            <Typography sx={{ fontWeight: 800, fontSize: '0.92rem', color: '#0F172A' }}>
              {flowState.maskedPhone || flowState.phone}
            </Typography>
            <Button
              size="small"
              onClick={() => navigate('/auth/login')}
              startIcon={<EditOutlinedIcon sx={{ fontSize: 14 }} />}
              sx={{
                p: 0,
                minWidth: 0,
                fontSize: '0.75rem',
                color: '#2563EB',
                textTransform: 'none',
                fontWeight: 700,
                ml: 0.5
              }}
            >
              Change
            </Button>
          </Box>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
            {error}
          </Alert>
        )}

        <form onSubmit={handleVerify}>
          <Stack spacing={3}>
            {/* 6-Digit OTP Boxes */}
            <Box>
              <OtpInputBoxes
                value={otp}
                onChange={val => {
                  setOtp(val);
                  if (error) setError('');
                }}
                disabled={busy}
              />
              <Typography sx={{ textAlign: 'center', fontSize: '0.78rem', color: '#64748B', mt: 1 }}>
                Test WhatsApp OTP code: <strong>123456</strong>
              </Typography>
            </Box>

            {/* Primary Button */}
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={busy || otp.length !== 6}
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
              {busy ? 'Verifying...' : 'Verify OTP'}
            </Button>

            {/* Resend OTP & Timer */}
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: '#64748B', fontSize: '0.88rem' }}>
                Didn&apos;t receive the code?{' '}
                {canResend ? (
                  <Link
                    component="button"
                    type="button"
                    onClick={handleResend}
                    disabled={busy}
                    sx={{
                      fontWeight: 700,
                      color: '#2563EB',
                      textDecoration: 'none',
                      '&:hover': { textDecoration: 'underline' }
                    }}
                  >
                    Resend OTP
                  </Link>
                ) : (
                  <Box component="span" sx={{ fontWeight: 700, color: '#334155' }}>
                    Resend in {formatTimer(timerSeconds)}
                  </Box>
                )}
              </Typography>
            </Box>

            {/* Change number link */}
            <Box sx={{ textAlign: 'center', pt: 1, borderTop: '1px solid #F1F5F9' }}>
              <Link
                component="button"
                type="button"
                variant="body2"
                onClick={() => navigate('/auth/login')}
                sx={{ color: '#64748B', textDecoration: 'none', '&:hover': { color: '#0F172A' } }}
              >
                ← Change mobile number
              </Link>
            </Box>
          </Stack>
        </form>
      </Box>
    </AuthPageLayout>
  );
};
