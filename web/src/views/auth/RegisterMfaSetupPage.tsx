import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Stack,
  Alert,
  Paper
} from '@mui/material';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import QrCode2OutlinedIcon from '@mui/icons-material/QrCode2Outlined';
import { useNavigate } from 'react-router-dom';
import { AuthPageLayout } from './AuthPageLayout';
import { OtpInputBoxes } from '../../components/auth/OtpInputBoxes';
import { authService } from '../../api/authService';

export const RegisterMfaSetupPage: React.FC = () => {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const flowState = authService.getFlowState();

  const handleCompleteMfaSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) {
      setError('Please enter the 6-digit code from your authenticator app.');
      return;
    }
    setError('');
    setBusy(true);

    try {
      const result = await authService.verifySuperAdminMfa(code);
      navigate('/auth/register/success', {
        state: {
          role: 'superadmin',
          phone: flowState.phone,
          user: result.user
        }
      });
    } catch (err: any) {
      setError(err.message || 'Incorrect verification code. Please check your app.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthPageLayout>
      <Box sx={{ width: '100%', maxWidth: 480, mx: 'auto', textAlign: 'center' }}>
        <Box
          sx={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            bgcolor: '#EFF6FF',
            color: '#2563EB',
            display: 'grid',
            placeItems: 'center',
            mx: 'auto',
            mb: 2
          }}
        >
          <ShieldOutlinedIcon sx={{ fontSize: 32 }} />
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
          Configure Authenticator MFA
        </Typography>
        <Typography variant="body2" sx={{ color: '#64748B', fontSize: '0.92rem', mb: 3 }}>
          Super Admin root authority requires two-factor authentication via Google or Microsoft Authenticator.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 3, borderRadius: 2, textAlign: 'left' }}>
            {error}
          </Alert>
        )}

        {/* QR Code Placeholder card */}
        <Paper
          variant="outlined"
          sx={{
            p: 2.5,
            borderRadius: 3,
            bgcolor: '#F8FAFC',
            borderColor: '#E2E8F0',
            mb: 3,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 1.5
          }}
        >
          <Box
            sx={{
              width: 140,
              height: 140,
              bgcolor: '#FFFFFF',
              borderRadius: 2,
              border: '1px solid #CBD5E1',
              display: 'grid',
              placeItems: 'center'
            }}
          >
            <QrCode2OutlinedIcon sx={{ fontSize: 90, color: '#0F172A' }} />
          </Box>
          <Typography sx={{ fontSize: '0.8rem', color: '#475569', fontWeight: 600 }}>
            Secret Setup Key: <code style={{ color: '#2563EB', fontWeight: 700 }}>AGRI-PUMP-ROOT-2026</code>
          </Typography>
          <Typography sx={{ fontSize: '0.76rem', color: '#94A3B8' }}>
            Scan with your authenticator app, then enter the generated 6-digit code below:
          </Typography>
        </Paper>

        <form onSubmit={handleCompleteMfaSetup}>
          <Stack spacing={3}>
            <Box>
              <OtpInputBoxes
                value={code}
                onChange={val => {
                  setCode(val);
                  if (error) setError('');
                }}
                disabled={busy}
              />
              <Typography sx={{ textAlign: 'center', fontSize: '0.78rem', color: '#64748B', mt: 1 }}>
                Test Authenticator Code: <strong>123456</strong>
              </Typography>
            </Box>

            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={busy || code.length !== 6}
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
              {busy ? 'Verifying...' : 'Verify & Complete Setup'}
            </Button>
          </Stack>
        </form>
      </Box>
    </AuthPageLayout>
  );
};
