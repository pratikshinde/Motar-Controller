import React, { useState } from 'react';
import { Box, Typography, TextField, Button, Stack, Alert, IconButton, InputAdornment, Link } from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useNavigate } from 'react-router-dom';
import { loginWithEmail, loginWithPassword } from '../../api/auth';
import { verifyMfa } from '../../api/mfa';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { isMfaRequired } from '../../types';

// A developer's machine only (`npm run dev`): the authenticator step also accepts the fixed development code.
const DEV_HELPERS = import.meta.env.DEV;

/** The website's sign-in. The admin and the platform owner sign in with an email and a password; distributors and dealers (who have no email) with
 *  their mobile number and the password they chose when they opened their QR. There is no sign-up here: the person above creates every account. */
export const LoginForm: React.FC = () => {
  const navigate = useNavigate();
  const { handleAuthResult } = useAuth();
  const { showToast } = useToast();

  const [byMobile, setByMobile] = useState(false);
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Authenticator (TOTP) challenge
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = byMobile ? await loginWithPassword(mobile, password) : await loginWithEmail(email, password);
      if (isMfaRequired(result)) {
        setMfaToken(result.mfa_token);
        setMfaCode(DEV_HELPERS ? '123456' : '');
        return;
      }
      handleAuthResult(result);
      showToast(`Signed in: ${result.user.full_name}`);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Sign-in failed');
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
      showToast(`Signed in: ${result.user.full_name}`);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Incorrect verification code. Check your authenticator app and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box sx={{ width: '100%', maxWidth: 460, mx: 'auto' }}>
      <Box sx={{ mb: 3.5 }}>
        <Typography
          variant="h4"
          sx={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, color: '#0F172A', fontSize: { xs: '1.75rem', sm: '2rem' }, letterSpacing: '-0.02em', mb: 0.75 }}
        >
          Sign in
        </Typography>
        <Typography variant="body2" sx={{ color: '#64748B', fontSize: '0.92rem' }}>
          {byMobile ? 'Distributors and dealers' : 'Admin and platform owner'}
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
          {error}
        </Alert>
      )}

      {mfaToken ? (
        <form onSubmit={handleMfaSubmit}>
          <Stack spacing={2.5} sx={{ alignItems: 'center', textAlign: 'center' }}>
            <Box sx={{ width: 56, height: 56, borderRadius: '50%', bgcolor: '#E4F5EA', display: 'grid', placeItems: 'center', color: '#0B7A3E' }}>
              <ShieldOutlinedIcon sx={{ fontSize: 32 }} />
            </Box>
            <Typography variant="h6" sx={{ fontWeight: 700, color: '#0F172A' }}>
              Two-Factor Authentication
            </Typography>
            <Typography variant="body2" sx={{ color: '#64748B', maxWidth: 360 }}>
              Enter the 6-digit verification code from your authenticator application.
            </Typography>
            {DEV_HELPERS && (
              <Box sx={{ p: 1.5, bgcolor: '#E4F5EA', borderRadius: 2, border: '1px solid #BFDBFE', width: '100%' }}>
                <Typography sx={{ fontSize: '0.8rem', color: '#1E40AF', fontWeight: 600 }}>
                  Dev testing: code <strong>123456</strong> or your authenticator code is accepted.
                </Typography>
              </Box>
            )}
            <TextField
              label="Authenticator Code"
              placeholder="123456"
              value={mfaCode}
              onChange={e => setMfaCode(e.target.value)}
              fullWidth
              autoFocus
              slotProps={{ htmlInput: { maxLength: 6, style: { letterSpacing: 6, fontWeight: 700, textAlign: 'center', fontSize: '1.25rem' } } }}
            />
            <Button type="submit" variant="contained" size="large" fullWidth disabled={busy || mfaCode.trim().length !== 6} sx={{ py: 1.3, borderRadius: 2, fontWeight: 700, textTransform: 'none' }}>
              Verify Code
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
              sx={{ color: '#0B7A3E', fontWeight: 600 }}
            >
              ← Back to sign in
            </Link>
          </Stack>
        </form>
      ) : (
        <form onSubmit={handleSubmit}>
          <Stack spacing={2.5}>
            <Box>
              <Typography sx={{ fontSize: '0.84rem', fontWeight: 600, color: '#334155', mb: 0.75 }}>{byMobile ? 'Mobile number' : 'Email'}</Typography>
              {byMobile ? (
                <TextField
                  key="mobile"
                  placeholder="98765 43210"
                  type="tel"
                  value={mobile}
                  onChange={e => setMobile(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  fullWidth
                  required
                  slotProps={{ input: { sx: { borderRadius: 2.2, bgcolor: '#FFFFFF' } } }}
                />
              ) : (
                <TextField
                  key="email"
                  placeholder="name@company.com"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  fullWidth
                  required
                  slotProps={{ input: { sx: { borderRadius: 2.2, bgcolor: '#FFFFFF' } } }}
                />
              )}
            </Box>

            <Box>
              <Typography sx={{ fontSize: '0.84rem', fontWeight: 600, color: '#334155', mb: 0.75 }}>Password</Typography>
              <TextField
                placeholder="Enter your password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                fullWidth
                required
                slotProps={{
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton onClick={() => setShowPassword(p => !p)} edge="end" size="small" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                          {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                        </IconButton>
                      </InputAdornment>
                    ),
                    sx: { borderRadius: 2.2, bgcolor: '#FFFFFF' }
                  }
                }}
              />
            </Box>

            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={busy || !(byMobile ? mobile.trim() : email.trim()) || !password}
              sx={{ py: 1.35, borderRadius: 2.2, fontWeight: 700, fontSize: '0.95rem', bgcolor: '#0B7A3E', textTransform: 'none', boxShadow: '0 4px 12px rgba(11, 122, 62, 0.25)', '&:hover': { bgcolor: '#08642F' } }}
            >
              {busy ? 'Signing in…' : 'Sign In'}
            </Button>

            <Box sx={{ p: 1.75, borderRadius: 2, bgcolor: '#F0F9FF', border: '1px solid #BAE6FD', display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
              <InfoOutlinedIcon sx={{ color: '#0284C7', fontSize: 20, mt: '2px', flexShrink: 0 }} />
              <Typography sx={{ fontSize: '0.82rem', color: '#0369A1', lineHeight: 1.45 }}>
                {byMobile
                  ? 'There is no sign-up here. You opened your account from the QR the person above you gave you. Forgot your password? Ask them for a new QR.'
                  : 'There is no sign-up here. Your email and password are given to you by the platform owner. Forgot your password? Ask the platform owner.'}
              </Typography>
            </Box>

            <Link
              component="button"
              type="button"
              variant="body2"
              data-testid="switch-login"
              onClick={() => {
                setByMobile(v => !v);
                setError('');
              }}
              sx={{ color: '#0B7A3E', fontWeight: 600, alignSelf: 'center' }}
            >
              {byMobile ? 'Admin? Use your email' : 'Distributor or dealer? Use your phone number'}
            </Link>
          </Stack>
        </form>
      )}
    </Box>
  );
};
