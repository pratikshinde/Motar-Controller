import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Card, CardContent, Typography, TextField, Button, Stack, Alert, CircularProgress } from '@mui/material';
import HowToRegIcon from '@mui/icons-material/HowToReg';
import { useTheme } from '@mui/material/styles';
import { ambientBackgroundImage } from '../theme';
import { completeRegistration, scanRegistration, verifyRegistration, type RegistrationGreeting } from '../api/registrations';
import { useAuth } from '../context/AuthContext';
import { isMfaRequired } from '../types';

const MIN_PASSWORD = 8;

/** The page the registration QR opens, for a new distributor or dealer. Opening it is the scan: the one-time password then appears on the admin's page.
 *  They type their mobile number and the password the admin sends, then choose their own password; only then is their account made.
 *  Reachable with no session on purpose: they have no account yet. */
export const RegisterView: React.FC = () => {
  const theme = useTheme();
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { handleAuthResult } = useAuth();

  const [hello, setHello] = useState<RegistrationGreeting | null>(null);
  const [linkError, setLinkError] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [ticket, setTicket] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Opening the page is the scan.
  useEffect(() => {
    let live = true;
    scanRegistration(token)
      .then(res => live && setHello(res))
      .catch((err: any) => live && setLinkError(err?.message || 'This link is not valid any more.'));
    return () => {
      live = false;
    };
  }, [token]);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      setTicket((await verifyRegistration(token, phone, code)).ticket);
    } catch (err: any) {
      setError(err?.message || 'The mobile number or the password is not right.');
    } finally {
      setBusy(false);
    }
  }

  async function finish(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < MIN_PASSWORD) return setError(`Choose a password of at least ${MIN_PASSWORD} characters.`);
    if (password !== again) return setError('The two passwords are not the same.');
    if (!ticket) return;
    setBusy(true);
    try {
      const result = await completeRegistration(token, ticket, password);
      if (isMfaRequired(result)) {
        setError('This account needs an extra verification step: sign in from the main login page.');
        return;
      }
      handleAuthResult(result);
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      setError(err?.message || 'Could not finish the registration.');
      if (/too long|type the mobile/i.test(err?.message || '')) setTicket(null);
    } finally {
      setBusy(false);
    }
  }

  const roleWord = hello?.role === 'distributor' ? 'distributor' : 'dealer';

  return (
    <Box
      sx={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', overflowY: 'auto', bgcolor: 'background.default', backgroundImage: ambientBackgroundImage(theme.palette.mode, theme.palette.m3) }}
    >
      <Card elevation={2} sx={{ width: '100%', maxWidth: 440, mx: 2, my: 2 }}>
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ width: 56, height: 56, borderRadius: 4, mx: 'auto', mb: 2, display: 'grid', placeItems: 'center', background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.m3.tertiary})` }}>
            <HowToRegIcon sx={{ color: theme.palette.m3.onPrimary, fontSize: 28 }} />
          </Box>

          {linkError ? (
            <>
              <Typography variant="h3" align="center" gutterBottom>
                This link has stopped working
              </Typography>
              <Alert severity="error" data-testid="link-error">
                {linkError}
              </Alert>
            </>
          ) : !hello ? (
            <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : !ticket ? (
            <>
              <Typography variant="h3" align="center" gutterBottom>
                Hello {hello.first_name}
              </Typography>
              <Typography variant="body2" align="center" color="text.secondary" sx={{ mb: 3 }}>
                {hello.registered_by ?? 'Someone'} is registering you as a {roleWord}
                {hello.brand ? ` for ${hello.brand}` : ''}. Type your mobile number and the password {hello.registered_by ? 'they' : 'you were'} sent you.
              </Typography>
              {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {error}
                </Alert>
              )}
              <form onSubmit={check}>
                <Stack spacing={2}>
                  <TextField label="Your mobile number" placeholder="98765 43210" type="tel" value={phone} onChange={e => setPhone(e.target.value)} required fullWidth autoFocus autoComplete="username" />
                  <TextField
                    label="The password you were sent"
                    placeholder="K7Q4-9MZB"
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    required
                    fullWidth
                    autoComplete="one-time-code"
                    slotProps={{ htmlInput: { style: { letterSpacing: 2, fontFamily: 'monospace' } } }}
                  />
                  <Button type="submit" variant="contained" size="large" disabled={busy || !phone.trim() || !code.trim()}>
                    {busy ? 'Checking…' : 'Continue'}
                  </Button>
                </Stack>
              </form>
            </>
          ) : (
            <>
              <Typography variant="h3" align="center" gutterBottom>
                Choose your own password
              </Typography>
              <Typography variant="body2" align="center" color="text.secondary" sx={{ mb: 3 }}>
                That was right. The password you were sent has done its job: choose one only you know. You will sign in with your mobile number and this password.
              </Typography>
              {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {error}
                </Alert>
              )}
              <form onSubmit={finish}>
                <Stack spacing={2}>
                  <TextField label={`Choose a password (at least ${MIN_PASSWORD} characters)`} type="password" value={password} onChange={e => setPassword(e.target.value)} required fullWidth autoFocus autoComplete="new-password" />
                  <TextField label="Type the password again" type="password" value={again} onChange={e => setAgain(e.target.value)} required fullWidth autoComplete="new-password" />
                  <Button type="submit" variant="contained" size="large" disabled={busy || !password || !again}>
                    {busy ? 'Creating your account…' : 'Finish registration'}
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
