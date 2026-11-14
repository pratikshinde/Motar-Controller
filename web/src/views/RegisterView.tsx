import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Card, CardContent, Typography, TextField, Button, Stack, Alert, CircularProgress } from '@mui/material';
import HowToRegIcon from '@mui/icons-material/HowToReg';
import { useTheme } from '@mui/material/styles';
import { ambientBackgroundImage } from '../theme';
import { completeRegistration, scanRegistration, type RegistrationGreeting } from '../api/registrations';
import { useAuth } from '../context/AuthContext';
import { isMfaRequired } from '../types';

const MIN_PASSWORD = 8;

/** The page the registration QR opens, for a new distributor or dealer. Opening it is the scan (the admin's page shows it).
 *  They type their mobile number and choose their own password; only then is their account made, with no pumps yet.
 *  Reachable with no session on purpose: they have no account yet. */
export const RegisterView: React.FC = () => {
  const theme = useTheme();
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { handleAuthResult } = useAuth();

  const [hello, setHello] = useState<RegistrationGreeting | null>(null);
  const [linkError, setLinkError] = useState('');
  const [phone, setPhone] = useState('');
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

  async function finish(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < MIN_PASSWORD) return setError(`Choose a password of at least ${MIN_PASSWORD} characters.`);
    if (password !== again) return setError('The two passwords are not the same.');
    setBusy(true);
    try {
      const result = await completeRegistration(token, phone, password);
      if (isMfaRequired(result)) {
        setError('This account needs an extra verification step: sign in from the main login page.');
        return;
      }
      handleAuthResult(result);
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      setError(err?.message || 'Could not finish the registration.');
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
          ) : (
            <>
              <Typography variant="h3" align="center" gutterBottom>
                Hello {hello.first_name}
              </Typography>
              <Typography variant="body2" align="center" color="text.secondary" sx={{ mb: 3 }}>
                {hello.registered_by ?? 'Someone'} is registering you as a {roleWord}
                {hello.brand ? ` for ${hello.brand}` : ''}. Type your mobile number and choose your own password. You will sign in with them.
              </Typography>
              {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {error}
                </Alert>
              )}
              <form onSubmit={finish}>
                <Stack spacing={2}>
                  <TextField label="Your mobile number" placeholder="98765 43210" type="tel" value={phone} onChange={e => setPhone(e.target.value)} required fullWidth autoFocus autoComplete="username" />
                  <TextField label={`Choose a password (at least ${MIN_PASSWORD} characters)`} type="password" value={password} onChange={e => setPassword(e.target.value)} required fullWidth autoComplete="new-password" />
                  <TextField label="Type the password again" type="password" value={again} onChange={e => setAgain(e.target.value)} required fullWidth autoComplete="new-password" />
                  <Button type="submit" variant="contained" size="large" disabled={busy || !phone.trim() || !password || !again}>
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
