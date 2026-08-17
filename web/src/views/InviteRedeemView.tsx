import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Card, CardContent, Typography, TextField, Button, Stack, Alert } from '@mui/material';
import GroupAddIcon from '@mui/icons-material/GroupAdd';
import { useTheme } from '@mui/material/styles';
import { redeemInvite } from '../api/invites';
import { useAuth } from '../context/AuthContext';
import { isMfaRequired } from '../types';

// FR-WEB-035 — the invited person lands here from a shared link, sets
// their own phone number and (optional) password, and is logged straight
// in. No auth gate on this route by design — nobody has an account yet.
export const InviteRedeemView: React.FC = () => {
  const theme = useTheme();
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { handleAuthResult } = useAuth();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError('');
    setBusy(true);
    try {
      const result = await redeemInvite(token, fullName.trim(), phone.trim(), password.trim() || undefined);
      if (isMfaRequired(result)) {
        // A redeemed invite can only ever create a fresh, non-MFA account
        // (roles that require MFA don't reach this branch on first login),
        // but stay honest about the shape rather than assuming it away.
        setError('This account requires additional verification — sign in from the main login page to continue.');
        return;
      }
      handleAuthResult(result);
      navigate('/', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Could not complete registration');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box sx={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', bgcolor: 'background.default' }}>
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
            <GroupAddIcon sx={{ color: theme.palette.m3.onPrimary, fontSize: 28 }} />
          </Box>
          <Typography variant="h3" align="center" gutterBottom>
            Join AgriPump SmartSpace
          </Typography>
          <Typography variant="body2" align="center" color="text.secondary" sx={{ mb: 3 }}>
            You've been invited to create an account
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <form onSubmit={handleSubmit}>
            <Stack spacing={2}>
              <TextField label="Full name" value={fullName} onChange={e => setFullName(e.target.value)} required fullWidth autoFocus />
              <TextField
                label="Mobile number (E.164 format)"
                placeholder="+91 XXXXX XXXXX"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                required
                fullWidth
                type="tel"
              />
              <TextField
                label="Password (optional — leave blank for OTP-only login)"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                fullWidth
              />
              <Button type="submit" variant="contained" size="large" disabled={busy}>
                Create account &amp; sign in
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>
    </Box>
  );
};
