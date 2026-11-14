import React, { useState } from 'react';
import { Box, Typography, TextField, Button, Stack, Alert, IconButton, InputAdornment, Link } from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useNavigate } from 'react-router-dom';
import { loginWithEmailCode, loginWithPassword, requestEmailCode } from '../../api/auth';
import { clearSession } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { isMfaRequired } from '../../types';
import { MfaChallenge } from './MfaChallenge';

export type LoginVariant = 'owner' | 'distributor' | 'dealer';

const TITLES: Record<LoginVariant, string> = {
  owner: 'Platform owner sign in',
  distributor: 'Distributor sign in',
  dealer: 'Dealer sign in'
};

const SUBTITLES: Record<LoginVariant, string> = {
  owner: 'Your email, then your authenticator app',
  distributor: 'Your mobile number and password',
  dealer: 'Your mobile number and password'
};

/** The website's sign-in for the platform owner (the emailed 6-digit code, then the code of an authenticator app), distributors and dealers (who have no
 *  email: their mobile number and the password they chose when they opened their QR). Admins have their own form (AdminLoginForm). There is no sign-up
 *  here: the person above creates every account. A sign-in that turns out to belong to another kind of person is refused and no session is kept. */
export const LoginForm: React.FC<{ variant: LoginVariant }> = ({ variant }) => {
  const navigate = useNavigate();
  const { handleAuthResult } = useAuth();
  const { showToast } = useToast();

  const byMobile = variant === 'distributor' || variant === 'dealer';
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [emailCode, setEmailCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // The authenticator step (the platform owner)
  const [mfaToken, setMfaToken] = useState<string | null>(null);

  /** Why this sign-in does not belong on this page, or null when it does. */
  function wrongPage(role: string | undefined): string | null {
    const r = (role || '').toLowerCase();
    if (variant === 'owner' && r !== 'superadmin') return 'This is not the platform owner’s email. Everyone else signs in with the Login button on the home page.';
    if (variant === 'distributor' && r !== 'distributor') return `This account is not a distributor. Choose ${r || 'your role'} on the previous page.`;
    if (variant === 'dealer' && r !== 'dealer') return `This account is not a dealer. Choose ${r || 'your role'} on the previous page.`;
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (!byMobile && !codeSent) {
        await requestEmailCode(email);
        setCodeSent(true);
        setEmailCode('');
        return;
      }
      const result = byMobile ? await loginWithPassword(mobile, password) : await loginWithEmailCode(email, emailCode);
      if (isMfaRequired(result)) {
        setMfaToken(result.mfa_token);
        return;
      }
      const refused = wrongPage(result.user?.role);
      if (refused) {
        clearSession();
        setError(refused);
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

  return (
    <Box sx={{ width: '100%', maxWidth: 460, mx: 'auto' }}>
      <Box sx={{ mb: 3.5 }}>
        <Typography
          variant="h4"
          sx={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 800, color: '#0F172A', fontSize: { xs: '1.75rem', sm: '2rem' }, letterSpacing: '-0.02em', mb: 0.75 }}
        >
          {TITLES[variant]}
        </Typography>
        <Typography variant="body2" sx={{ color: '#64748B', fontSize: '0.92rem' }}>
          {SUBTITLES[variant]}
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
          refuse={result => wrongPage(result.user?.role)}
          onSignedIn={result => {
            handleAuthResult(result);
            showToast(`Signed in: ${result.user.full_name}`);
            navigate('/dashboard');
          }}
          onBack={message => {
            setMfaToken(null);
            if (message) setError(message);
          }}
        />
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
                  onChange={e => {
                    setEmail(e.target.value);
                    setCodeSent(false);
                  }}
                  autoComplete="username"
                  autoFocus
                  fullWidth
                  required
                  slotProps={{ input: { sx: { borderRadius: 2.2, bgcolor: '#FFFFFF' } } }}
                />
              )}
            </Box>

{byMobile && (
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
            )}

            {!byMobile && codeSent && (
              <Box>
                <Alert severity="success" sx={{ mb: 1.5, borderRadius: 2 }} data-testid="code-sent">
                  A 6-digit code was sent to {email.trim()}. It works for 10 minutes. Check your spam folder if it does not arrive.
                </Alert>
                <Typography sx={{ fontSize: '0.84rem', fontWeight: 600, color: '#334155', mb: 0.75 }}>Code from your email</Typography>
                <TextField
                  placeholder="123456"
                  value={emailCode}
                  onChange={e => setEmailCode(e.target.value)}
                  autoComplete="one-time-code"
                  autoFocus
                  fullWidth
                  required
                  slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6, style: { letterSpacing: 6, fontWeight: 700, fontSize: '1.2rem' } }, input: { sx: { borderRadius: 2.2, bgcolor: '#FFFFFF' } } }}
                />
              </Box>
            )}

            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={busy || (byMobile ? !(mobile.trim() && password) : !email.trim() || (codeSent && emailCode.trim().length !== 6))}
              sx={{ py: 1.35, borderRadius: 2.2, fontWeight: 700, fontSize: '0.95rem', bgcolor: '#0B7A3E', textTransform: 'none', boxShadow: '0 4px 12px rgba(11, 122, 62, 0.25)', '&:hover': { bgcolor: '#08642F' } }}
            >
              {busy ? (byMobile || codeSent ? 'Signing in…' : 'Sending…') : byMobile || codeSent ? 'Sign In' : 'Send me a code'}
            </Button>

            <Box sx={{ p: 1.75, borderRadius: 2, bgcolor: '#F0F9FF', border: '1px solid #BAE6FD', display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
              <InfoOutlinedIcon sx={{ color: '#0284C7', fontSize: 20, mt: '2px', flexShrink: 0 }} />
              <Typography sx={{ fontSize: '0.82rem', color: '#0369A1', lineHeight: 1.45 }}>
                {byMobile
                  ? 'There is no sign-up here. You opened your account from the QR the person above you gave you. Forgot your password? Ask them for a new QR.'
                  : 'There is no password. We email a 6-digit code to your address, and then you enter the code of your authenticator app.'}
              </Typography>
            </Box>

            <Link
              component="button"
              type="button"
              variant="body2"
              data-testid="back-link"
              onClick={() => navigate(variant === 'owner' ? '/' : '/login')}
              sx={{ color: '#0B7A3E', fontWeight: 600, alignSelf: 'center' }}
            >
              {variant === 'owner' ? '← Back to the home page' : '← Choose a different role'}
            </Link>
          </Stack>
        </form>
      )}
    </Box>
  );
};
