import React, { useState } from 'react';
import { Alert, Box, Button, IconButton, InputAdornment, Link, Stack, TextField, Typography } from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useNavigate } from 'react-router-dom';
import { loginWithEmail, setAdminPassword } from '../../api/auth';
import { clearSession } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { isMfaRequired } from '../../types';
import { MfaChallenge } from './MfaChallenge';

const MIN_PASSWORD = 10;
const FIELD = { sx: { borderRadius: 2.2, bgcolor: '#FFFFFF' } };
const LABEL = { fontSize: '0.84rem', fontWeight: 600, color: '#334155', mb: 0.75 } as const;
const PRIMARY = { py: 1.35, borderRadius: 2.2, fontWeight: 700, fontSize: '0.95rem', bgcolor: '#0B7A3E', textTransform: 'none', boxShadow: '0 4px 12px rgba(11, 122, 62, 0.25)', '&:hover': { bgcolor: '#08642F' } } as const;

type Mode = 'password' | 'choose';

const WRONG_ROLE = 'This is not an admin account. Choose your role on the previous page.';
const OWNER_ROLE = 'The platform owner signs in with the lock icon on the home page.';

/** The admin's sign-in: their email and the password they chose. The first time, they type their email, the 6-digit code that was emailed to them when the platform
 *  owner added them (the same code they read out) and a password of their own. The code works once and is never needed again. If they forget the password, the
 *  platform owner sends a new code and they do the first-time step again. */
export const AdminLoginForm: React.FC = () => {
  const navigate = useNavigate();
  const { handleAuthResult } = useAuth();
  const { showToast } = useToast();

  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);

  const refuse = (role: string | undefined): string | null => {
    const r = (role || '').toLowerCase();
    if (r === 'manufacturer') return null;
    return r === 'superadmin' ? OWNER_ROLE : WRONG_ROLE;
  };

  function finish(result: { user: { full_name: string; role?: string } } & any) {
    const refused = refuse(result.user?.role);
    if (refused) {
      clearSession();
      setError(refused);
      return;
    }
    handleAuthResult(result);
    showToast(`Signed in: ${result.user.full_name}`);
    navigate('/dashboard');
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await loginWithEmail(email, password);
      if (isMfaRequired(result)) {
        setMfaToken(result.mfa_token);
        return;
      }
      finish(result);
    } catch (err: any) {
      setError(err.message || 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  async function choosePassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (newPassword.length < MIN_PASSWORD) return setError(`Choose a password of at least ${MIN_PASSWORD} characters.`);
    if (newPassword !== again) return setError('The two passwords are not the same.');
    setBusy(true);
    try {
      const result = await setAdminPassword(email, code, newPassword);
      if (isMfaRequired(result)) {
        setMfaToken(result.mfa_token);
        return;
      }
      finish(result);
    } catch (err: any) {
      setError(err.message || 'Could not set the password.');
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'password' ? 'Admin sign in' : 'Set your password';
  const subtitle = mode === 'password' ? 'Your email and password' : 'Your email, the code from your email, and a password of your own';

  return (
    <Box sx={{ width: '100%', maxWidth: 460, mx: 'auto' }}>
      <Box sx={{ mb: 3.5 }}>
        <Typography variant="h4" sx={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, color: '#0F172A', fontSize: { xs: '1.75rem', sm: '2rem' }, letterSpacing: '-0.02em', mb: 0.75 }}>
          {title}
        </Typography>
        <Typography variant="body2" sx={{ color: '#64748B', fontSize: '0.92rem' }}>
          {subtitle}
        </Typography>
      </Box>

      {error && !mfaToken && (
        <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
          {error}
        </Alert>
      )}

      {mfaToken ? (
        <MfaChallenge
          token={mfaToken}
          refuse={result => refuse(result.user?.role)}
          onSignedIn={result => finish(result)}
          onBack={message => {
            setMfaToken(null);
            if (message) setError(message);
          }}
        />
      ) : mode === 'password' ? (
        <form onSubmit={signIn}>
          <Stack spacing={2.5}>
            <Box>
              <Typography sx={LABEL}>Email</Typography>
              <TextField placeholder="name@company.com" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" autoFocus fullWidth required slotProps={{ input: FIELD }} />
            </Box>
            <Box>
              <Typography sx={LABEL}>Password</Typography>
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
                    ...FIELD
                  }
                }}
              />
            </Box>
            <Button type="submit" variant="contained" size="large" disabled={busy || !email.trim() || !password} sx={PRIMARY}>
              {busy ? 'Signing in…' : 'Sign In'}
            </Button>
            <Box sx={{ p: 1.75, borderRadius: 2, bgcolor: '#F0F9FF', border: '1px solid #BAE6FD', display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
              <InfoOutlinedIcon sx={{ color: '#0284C7', fontSize: 20, mt: '2px', flexShrink: 0 }} />
              <Typography sx={{ fontSize: '0.82rem', color: '#0369A1', lineHeight: 1.45 }}>
                There is no sign-up here. The platform owner adds you and a code is emailed to you. The first time, use the link below with that code to choose your own password. Forgot it later? Ask the platform owner for a new code.
              </Typography>
            </Box>
            <Link
              component="button"
              type="button"
              variant="body2"
              data-testid="first-time"
              onClick={() => {
                setError('');
                setMode('choose');
              }}
              sx={{ color: '#0B7A3E', fontWeight: 600, alignSelf: 'center' }}
            >
              First time here? Choose your password
            </Link>
          </Stack>
        </form>
      ) : (
        <form onSubmit={choosePassword}>
          <Stack spacing={2.5}>
            <Box>
              <Typography sx={LABEL}>Email</Typography>
              <TextField placeholder="name@company.com" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" autoFocus fullWidth required slotProps={{ input: FIELD }} />
            </Box>
            <Box>
              <Typography sx={LABEL}>Code from your email</Typography>
              <TextField
                placeholder="123456"
                value={code}
                onChange={e => setCode(e.target.value)}
                autoComplete="one-time-code"
                fullWidth
                required
                slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6, style: { letterSpacing: 6, fontWeight: 700, fontSize: '1.2rem' } }, input: FIELD }}
              />
            </Box>
            <Box>
              <Typography sx={LABEL}>Choose a password (at least {MIN_PASSWORD} characters)</Typography>
              <TextField type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} autoComplete="new-password" fullWidth required slotProps={{ input: FIELD, htmlInput: { 'aria-label': 'New password' } }} />
            </Box>
            <Box>
              <Typography sx={LABEL}>Type it again</Typography>
              <TextField type="password" value={again} onChange={e => setAgain(e.target.value)} autoComplete="new-password" fullWidth required slotProps={{ input: FIELD, htmlInput: { 'aria-label': 'New password again' } }} />
            </Box>
            <Button type="submit" variant="contained" size="large" disabled={busy || !email.trim() || code.trim().length !== 6 || !newPassword || !again} sx={PRIMARY}>
              {busy ? 'Saving…' : 'Set password and sign in'}
            </Button>
            <Typography sx={{ fontSize: '0.82rem', color: '#64748B', textAlign: 'center' }}>
              No code, or it stopped working? Ask the platform owner to send you a new one.
            </Typography>
          </Stack>
        </form>
      )}

      <Box sx={{ textAlign: 'center', mt: 3 }}>
        <Link
          component="button"
          type="button"
          variant="body2"
          data-testid="back-link"
          onClick={() => (mode === 'password' || mfaToken ? navigate('/login') : (setError(''), setMode('password')))}
          sx={{ color: '#0B7A3E', fontWeight: 600 }}
        >
          {mode === 'password' || mfaToken ? '← Choose a different role' : '← Back to sign in'}
        </Link>
      </Box>
    </Box>
  );
};
