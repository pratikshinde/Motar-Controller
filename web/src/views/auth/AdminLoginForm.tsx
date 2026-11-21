import React, { useState } from 'react';
import { Alert, Box, Button, IconButton, InputAdornment, Link, Stack, TextField, Typography } from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useNavigate } from 'react-router-dom';
import { adminNeedsFirstPassword, loginWithEmail, loginWithEmailCode, requestAdminCode, requestEmailCode, setAdminPassword } from '../../api/auth';
import { clearSession } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { isMfaRequired } from '../../types';
import { MfaChallenge } from './MfaChallenge';

const MIN_PASSWORD = 10;
const FIELD = { sx: { borderRadius: 2.2, bgcolor: '#FFFFFF' } };
const LABEL = { fontSize: '0.84rem', fontWeight: 600, color: '#334155', mb: 0.75 } as const;
const PRIMARY = { py: 1.35, borderRadius: 2.2, fontWeight: 700, fontSize: '0.95rem', bgcolor: '#0B7A3E', textTransform: 'none', boxShadow: '0 4px 12px rgba(11, 122, 62, 0.25)', '&:hover': { bgcolor: '#08642F' } } as const;

/** `password`: email and password. `first`: the platform owner has confirmed this email and no password exists yet, so the page asks them to choose one right
 *  below the email. `ask` / `code`: Forgot password: the email, then the emailed code with a new password. */
type Mode = 'password' | 'first' | 'ask' | 'code' | 'signinAsk' | 'signinCode';
/* `signinAsk` / `signinCode`: sign in with an emailed 6-digit code, no password (admins of a brand that uses emailed codes, e.g. SolarLogger). */

const WRONG_ROLE = 'This is not an admin account. Choose your role on the previous page.';
const OWNER_ROLE = 'The platform owner signs in with the lock icon on the home page.';

/** The admin's sign-in: their email and the password they chose. The first time, the page notices (from the email) that no password is set yet and asks them to
 *  choose one below the email. If they forget it, "Forgot password" emails a code and they choose a new one. The password is saved in the database. */
export const AdminLoginForm: React.FC = () => {
  const navigate = useNavigate();
  const { handleAuthResult } = useAuth();
  const { showToast } = useToast();

  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [checkedEmail, setCheckedEmail] = useState('');
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

  /** Ask the server whether this email still has to choose its first password, and show the matching fields. Returns the mode the page is now in. */
  async function checkEmail(): Promise<Mode> {
    const address = email.trim().toLowerCase();
    if (!address || (mode !== 'password' && mode !== 'first')) return mode;
    if (address === checkedEmail) return mode;
    let first = false;
    try {
      first = await adminNeedsFirstPassword(address);
    } catch {
      first = false;
    }
    setCheckedEmail(address);
    setNewPassword('');
    setAgain('');
    const next: Mode = first ? 'first' : 'password';
    setMode(next);
    return next;
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const now = await checkEmail();
      if (now === 'first') return; // the page now asks for a new password instead
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

  function checkNewPassword(): string | null {
    if (newPassword.length < MIN_PASSWORD) return `Choose a password of at least ${MIN_PASSWORD} characters.`;
    if (newPassword !== again) return 'The two passwords are not the same.';
    return null;
  }

  async function chooseFirstPassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const problem = checkNewPassword();
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const result = await setAdminPassword(email, newPassword);
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

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await requestAdminCode(email);
      setCode('');
      setNewPassword('');
      setAgain('');
      setMode('code');
    } catch (err: any) {
      setError(err.message || 'Could not send the code. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  async function chooseNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const problem = checkNewPassword();
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const result = await setAdminPassword(email, newPassword, code);
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

  async function sendSignInCode(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await requestEmailCode(email);
      setCode('');
      setMode('signinCode');
    } catch (err: any) {
      setError(err.message || 'Could not send the code. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  async function signInWithCode(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await loginWithEmailCode(email, code.trim());
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

  const byCode = mode === 'signinAsk' || mode === 'signinCode';
  const title = byCode ? 'Admin sign in' : mode === 'first' ? 'Set your password' : mode === 'password' ? 'Admin sign in' : 'Forgot password';
  const subtitle =
    mode === 'signinAsk'
      ? 'We email you a 6-digit code: no password needed'
      : mode === 'signinCode'
        ? 'Type the code from your email'
        : mode === 'password'
      ? 'Your email and password'
      : mode === 'first'
        ? 'Your email is confirmed. Choose a password to finish.'
        : mode === 'ask'
          ? 'We email you a code to confirm it is you'
          : 'Type the code from your email, then choose a new password';

  const passwordFields = (
    <>
      <Box>
        <Typography sx={LABEL}>{mode === 'first' ? 'Set password' : 'New password'} (at least {MIN_PASSWORD} characters)</Typography>
        <TextField type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} autoComplete="new-password" fullWidth required autoFocus={mode === 'first'} slotProps={{ input: FIELD, htmlInput: { 'aria-label': 'New password' } }} />
      </Box>
      <Box>
        <Typography sx={LABEL}>Confirm password</Typography>
        <TextField type="password" value={again} onChange={e => setAgain(e.target.value)} autoComplete="new-password" fullWidth required slotProps={{ input: FIELD, htmlInput: { 'aria-label': 'New password again' } }} />
      </Box>
    </>
  );

  const emailField = (readOnly: boolean) => (
    <Box>
      <Typography sx={LABEL}>Email</Typography>
      <TextField
        placeholder="name@company.com"
        type="email"
        value={email}
        onChange={e => {
          setEmail(e.target.value);
          if (mode === 'first') {
            setMode('password');
            setCheckedEmail('');
          }
        }}
        onBlur={() => void checkEmail()}
        autoComplete="username"
        autoFocus={mode === 'password' || mode === 'ask' || mode === 'signinAsk'}
        fullWidth
        required
        disabled={readOnly}
        slotProps={{ input: FIELD }}
      />
    </Box>
  );

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
      ) : mode === 'password' || mode === 'first' ? (
        <form onSubmit={mode === 'first' ? chooseFirstPassword : signIn}>
          <Stack spacing={2.5}>
            {emailField(false)}
            {mode === 'password' ? (
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
            ) : (
              <>
                <Alert severity="success" sx={{ borderRadius: 2 }} data-testid="first-time-note">
                  The platform owner has added you. Choose your password now: you will use it to sign in from now on.
                </Alert>
                {passwordFields}
              </>
            )}
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={busy || !email.trim() || (mode === 'password' ? !password : !newPassword || !again)}
              sx={PRIMARY}
            >
              {busy ? (mode === 'first' ? 'Saving…' : 'Signing in…') : mode === 'first' ? 'Set password and sign in' : 'Sign In'}
            </Button>
            {mode === 'password' && (
              <>
                <Box sx={{ p: 1.75, borderRadius: 2, bgcolor: '#F0F9FF', border: '1px solid #BAE6FD', display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
                  <InfoOutlinedIcon sx={{ color: '#0284C7', fontSize: 20, mt: '2px', flexShrink: 0 }} />
                  <Typography sx={{ fontSize: '0.82rem', color: '#0369A1', lineHeight: 1.45 }}>
                    There is no sign-up here. The platform owner adds you. The first time, type your email and the page will ask you to choose a password.
                  </Typography>
                </Box>
                <Link
                  component="button"
                  type="button"
                  variant="body2"
                  data-testid="code-signin"
                  onClick={() => {
                    setError('');
                    setMode('signinAsk');
                  }}
                  sx={{ color: '#0B7A3E', fontWeight: 600, alignSelf: 'center' }}
                >
                  Sign in with an emailed code instead
                </Link>
                <Link
                  component="button"
                  type="button"
                  variant="body2"
                  data-testid="forgot"
                  onClick={() => {
                    setError('');
                    setMode('ask');
                  }}
                  sx={{ color: '#0B7A3E', fontWeight: 600, alignSelf: 'center' }}
                >
                  Forgot password?
                </Link>
              </>
            )}
          </Stack>
        </form>
      ) : mode === 'signinAsk' ? (
        <form onSubmit={sendSignInCode}>
          <Stack spacing={2.5}>
            {emailField(false)}
            <Button type="submit" variant="contained" size="large" disabled={busy || !email.trim()} sx={PRIMARY}>
              {busy ? 'Sending…' : 'Send me a code'}
            </Button>
          </Stack>
        </form>
      ) : mode === 'signinCode' ? (
        <form onSubmit={signInWithCode}>
          <Stack spacing={2.5}>
            <Alert severity="success" sx={{ borderRadius: 2 }} data-testid="signin-code-sent">
              If {email.trim()} is an admin email that signs in with a code, a 6-digit code was sent to it. It works for 30 minutes. Check your spam folder if it does not arrive.
            </Alert>
            <Box>
              <Typography sx={LABEL}>Code from your email</Typography>
              <TextField
                placeholder="123456"
                value={code}
                onChange={e => setCode(e.target.value)}
                autoComplete="one-time-code"
                autoFocus
                fullWidth
                required
                slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6, style: { letterSpacing: 6, fontWeight: 700, fontSize: '1.2rem' } }, input: FIELD }}
              />
            </Box>
            <Button type="submit" variant="contained" size="large" disabled={busy || code.trim().length !== 6} sx={PRIMARY}>
              {busy ? 'Signing in…' : 'Sign In'}
            </Button>
            <Link component="button" type="button" variant="body2" onClick={() => setMode('signinAsk')} sx={{ color: '#0B7A3E', fontWeight: 600, alignSelf: 'center' }}>
              Send a new code
            </Link>
          </Stack>
        </form>
      ) : mode === 'ask' ? (
        <form onSubmit={sendCode}>
          <Stack spacing={2.5}>
            {emailField(false)}
            <Button type="submit" variant="contained" size="large" disabled={busy || !email.trim()} sx={PRIMARY}>
              {busy ? 'Sending…' : 'Send me a code'}
            </Button>
          </Stack>
        </form>
      ) : (
        <form onSubmit={chooseNewPassword}>
          <Stack spacing={2.5}>
            <Alert severity="success" sx={{ borderRadius: 2 }} data-testid="code-sent">
              If {email.trim()} is an admin email, a 6-digit code was sent to it. It works for 30 minutes. Check your spam folder if it does not arrive.
            </Alert>
            <Box>
              <Typography sx={LABEL}>Code from your email</Typography>
              <TextField
                placeholder="123456"
                value={code}
                onChange={e => setCode(e.target.value)}
                autoComplete="one-time-code"
                autoFocus
                fullWidth
                required
                slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6, style: { letterSpacing: 6, fontWeight: 700, fontSize: '1.2rem' } }, input: FIELD }}
              />
            </Box>
            {passwordFields}
            <Button type="submit" variant="contained" size="large" disabled={busy || code.trim().length !== 6 || !newPassword || !again} sx={PRIMARY}>
              {busy ? 'Saving…' : 'Set new password and sign in'}
            </Button>
            <Link component="button" type="button" variant="body2" onClick={() => setMode('ask')} sx={{ color: '#0B7A3E', fontWeight: 600, alignSelf: 'center' }}>
              Send a new code
            </Link>
          </Stack>
        </form>
      )}

      <Box sx={{ textAlign: 'center', mt: 3 }}>
        <Link
          component="button"
          type="button"
          variant="body2"
          data-testid="back-link"
          onClick={() => (mode === 'ask' || mode === 'code' || byCode ? (setError(''), setMode('password')) : navigate('/login'))}
          sx={{ color: '#0B7A3E', fontWeight: 600 }}
        >
          {mode === 'ask' || mode === 'code' || byCode ? '← Back to sign in' : '← Choose a different role'}
        </Link>
      </Box>
    </Box>
  );
};
