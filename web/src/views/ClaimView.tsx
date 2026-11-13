import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Card, CardContent, Typography, TextField, Button, Stack, Alert } from '@mui/material';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import { useTheme } from '@mui/material/styles';
import { ambientBackgroundImage } from '../theme';
import { claimPartnerAccount } from '../api/auth';
import { useAuth } from '../context/AuthContext';
import { isMfaRequired } from '../types';

const MIN_PASSWORD = 8;

/** Where a distributor or dealer lands after scanning the QR the person above them gave out. They type the mobile number registered for them
 *  and choose a password: no code is sent to anyone. Afterwards they sign in with the mobile number and that password.
 *  Reachable with no session on purpose: nobody has signed in yet. */
export const ClaimView: React.FC = () => {
  const theme = useTheme();
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { handleAuthResult } = useAuth();

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError('');
    if (password.length < MIN_PASSWORD) return setError(`Choose a password of at least ${MIN_PASSWORD} characters.`);
    if (password !== again) return setError('The two passwords are not the same.');
    setBusy(true);
    try {
      const result = await claimPartnerAccount(token, phone, password);
      if (isMfaRequired(result)) {
        setError('This account needs an extra verification step: sign in from the main login page.');
        return;
      }
      handleAuthResult(result);
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Could not open this link.');
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
        overflowY: 'auto',
        bgcolor: 'background.default',
        backgroundImage: ambientBackgroundImage(theme.palette.mode, theme.palette.m3)
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
            <LockOpenIcon sx={{ color: theme.palette.m3.onPrimary, fontSize: 28 }} />
          </Box>
          <Typography variant="h3" align="center" gutterBottom>
            Open your account
          </Typography>
          <Typography variant="body2" align="center" color="text.secondary" sx={{ mb: 3 }}>
            Type the mobile number that was registered for you and choose a password. You will use that number and password to sign in.
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <form onSubmit={submit}>
            <Stack spacing={2}>
              <TextField
                label="Your mobile number"
                placeholder="98765 43210"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                type="tel"
                required
                fullWidth
                autoFocus
                autoComplete="username"
              />
              <TextField
                label={`Choose a password (at least ${MIN_PASSWORD} characters)`}
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                fullWidth
                autoComplete="new-password"
              />
              <TextField label="Type the password again" type="password" value={again} onChange={e => setAgain(e.target.value)} required fullWidth autoComplete="new-password" />
              <Button type="submit" variant="contained" size="large" disabled={busy || !phone.trim() || !password || !again}>
                {busy ? 'Opening…' : 'Open my account'}
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
};
