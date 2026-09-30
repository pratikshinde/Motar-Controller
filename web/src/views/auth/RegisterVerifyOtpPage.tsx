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
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AuthPageLayout } from './AuthPageLayout';
import { OtpInputBoxes } from '../../components/auth/OtpInputBoxes';
import { WhatsAppIcon } from '../../components/auth/WhatsAppIcon';
import { authService } from '../../api/authService';
import type { RoleTier } from '../../types';

export const RegisterVerifyOtpPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const role = (searchParams.get('role') as RoleTier) || 'dealer';

  const flowState = authService.getFlowState();
  const [otp, setOtp] = useState('');
  const [timerSeconds, setTimerSeconds] = useState(28);
  const [canResend, setCanResend] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!flowState.phone) {
      navigate(`/auth/register/phone?role=${role}`, { replace: true });
    }
  }, [flowState.phone, navigate, role]);

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
      await authService.sendWhatsAppOtp(flowState.phone, { isRegistration: true, role });
      setTimerSeconds(28);
      setCanResend(false);
      setOtp('');
    } catch (err: any) {
      setError(err.message || 'Failed to resend OTP.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 6) {
      setError('Please enter the 6-digit OTP code.');
      return;
    }
    setError('');
    setBusy(true);

    try {
      const outcome = await authService.verifyWhatsAppOtp(flowState.phone, otp, {
        isRegistration: true,
        role
      });

      // If Super Admin: Proceed to MFA setup
      if (role === 'superadmin' || outcome.requiresMfa) {
        navigate('/auth/register/mfa');
        return;
      }

      // Other roles: Account created successfully!
      navigate('/auth/register/success', {
        state: {
          role,
          phone: flowState.phone,
          user: outcome.authResult?.user
        }
      });
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
            Verify your WhatsApp number
          </Typography>
          <Typography variant="body2" sx={{ color: '#64748B', fontSize: '0.94rem' }}>
            We&apos;ve sent a 6-digit OTP to your WhatsApp number:
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
              onClick={() => navigate(`/auth/register/phone?role=${role}`)}
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

            {/* Submit Button */}
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
              {busy ? 'Creating Account...' : 'Verify & Create Account'}
            </Button>

            {/* Resend timer */}
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
          </Stack>
        </form>
      </Box>
    </AuthPageLayout>
  );
};
