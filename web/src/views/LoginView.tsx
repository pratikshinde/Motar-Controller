import React, { useState } from 'react';
import {
  Box, Card, CardContent, Typography, TextField, Button, Link, Stack,
  ToggleButtonGroup, ToggleButton, Alert
} from '@mui/material';
import ElectricBoltIcon from '@mui/icons-material/ElectricBolt';
import ShieldIcon from '@mui/icons-material/Shield';
import { useTheme } from '@mui/material/styles';
import { sendSmsOtp, verifyOtp, loginWithPassword } from '../api/auth';
import { verifyMfa } from '../api/mfa';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import { useToast } from '../context/ToastContext';
import { isMfaRequired } from '../types';

type AuthMode = 'otp' | 'password';

export const LoginView: React.FC = () => {
  const theme = useTheme();
  const { handleAuthResult } = useAuth();
  const { t } = useLocale();
  const { showToast } = useToast();

  const [mode, setMode] = useState<AuthMode>('otp');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [otpRequested, setOtpRequested] = useState(false);
  const [devOtpNotice, setDevOtpNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Set once step 1 succeeds but the account has TOTP enabled — switches
  // the form to the MFA code step instead of finishing login.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  async function handleSendOtp() {
    if (!phone.trim()) {
      showToast('Please enter your mobile phone number first', true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = await sendSmsOtp(phone.trim());
      setOtpRequested(true);
      if (data.dev_otp) {
        setDevOtpNotice(`[Dev test code: ${data.dev_otp}]`);
        setOtp(data.dev_otp);
      } else {
        setDevOtpNotice(`SMS OTP sent to ${phone.trim()}`);
      }
      showToast(`SMS OTP challenge sent to ${phone.trim()}`);
    } catch (err: any) {
      showToast(err.message || 'OTP request failed', true);
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result =
        mode === 'password'
          ? await loginWithPassword(phone.trim(), password.trim())
          : await verifyOtp(phone.trim(), otp.trim());

      if (isMfaRequired(result)) {
        setMfaToken(result.mfa_token);
        return;
      }
      handleAuthResult(result);
      showToast(`Authenticated session active: ${result.user.full_name}`);
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setError('');
    setBusy(true);
    try {
      const result = await verifyMfa(mfaToken, mfaCode.trim());
      handleAuthResult(result);
      showToast(`Authenticated session active: ${result.user.full_name}`);
    } catch (err: any) {
      setError(err.message || 'Incorrect code');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        bgcolor: 'background.default'
      }}
    >
      <Card elevation={2} sx={{ width: '100%', maxWidth: 440, mx: 2 }}>
        <CardContent sx={{ p: 4 }}>
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: 4,
              mx: 'auto',
              mb: 2,
              display: 'grid',
              placeItems: 'center',
              background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.m3.tertiary})`
            }}
          >
            <ElectricBoltIcon sx={{ color: theme.palette.m3.onPrimary, fontSize: 28 }} />
          </Box>
          <Typography variant="h3" align="center" gutterBottom>
            {t.loginTitle}
          </Typography>
          <Typography variant="body2" align="center" color="text.secondary" sx={{ mb: 3 }}>
            {t.loginSubtitle}
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {mfaToken ? (
            <form onSubmit={handleMfaSubmit}>
              <Stack spacing={2} sx={{ alignItems: 'center' }}>
                <ShieldIcon color="primary" sx={{ fontSize: 32 }} />
                <Typography variant="body2" color="text.secondary" align="center">
                  Enter the 6-digit code from your authenticator app
                </Typography>
                <TextField
                  label="Authenticator code"
                  placeholder="123456"
                  value={mfaCode}
                  onChange={e => setMfaCode(e.target.value)}
                  fullWidth
                  autoFocus
                  slotProps={{ htmlInput: { maxLength: 6, style: { letterSpacing: 4, fontWeight: 700, textAlign: 'center' } } }}
                />
                <Button type="submit" variant="contained" size="large" fullWidth disabled={busy || mfaCode.trim().length !== 6}>
                  Verify
                </Button>
                <Link
                  component="button"
                  type="button"
                  variant="body2"
                  onClick={() => {
                    setMfaToken(null);
                    setMfaCode('');
                    setError('');
                  }}
                >
                  Back to sign in
                </Link>
              </Stack>
            </form>
          ) : (
            <>
              <ToggleButtonGroup
                value={mode}
                exclusive
                fullWidth
                size="small"
                onChange={(_, val) => val && setMode(val)}
                sx={{ mb: 3 }}
              >
                <ToggleButton value="otp">SMS OTP</ToggleButton>
                <ToggleButton value="password">Admin Password</ToggleButton>
              </ToggleButtonGroup>

              <form onSubmit={handleSubmit}>
            <Stack spacing={2}>
              <TextField
                label="Mobile number (E.164 format)"
                placeholder="+91 XXXXX XXXXX"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                fullWidth
                required
                type="tel"
              />

              {mode === 'otp' && (
                <>
                  <TextField
                    label="6-digit SMS OTP code"
                    placeholder="123456"
                    value={otp}
                    onChange={e => setOtp(e.target.value)}
                    fullWidth
                    slotProps={{ htmlInput: { maxLength: 6, style: { letterSpacing: 4, fontWeight: 700, textAlign: 'center' } } }}
                    helperText={devOtpNotice || undefined}
                  />
                  <Button variant="tonal" onClick={handleSendOtp} disabled={busy}>
                    Send SMS OTP
                  </Button>
                </>
              )}

              {mode === 'password' && (
                <TextField
                  label="Password (admin accounts)"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  fullWidth
                />
              )}

              <Button type="submit" variant="contained" size="large" disabled={busy || (mode === 'otp' && !otpRequested)}>
                {mode === 'password' ? 'Sign in with password' : 'Verify OTP & sign in'}
              </Button>
            </Stack>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};
