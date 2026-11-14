import React, { useState } from 'react';
import { Alert, Box, Button, Link, Stack, TextField, Typography } from '@mui/material';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import { clearSession } from '../../api/client';
import { verifyMfa } from '../../api/mfa';

type Signed = Awaited<ReturnType<typeof verifyMfa>>;

/** The authenticator step after the first one: the 6-digit code from the person's authenticator app. Real codes only: nothing is pre-filled. */
export const MfaChallenge: React.FC<{
  token: string;
  /** Why this account does not belong on this page, or null when it does. */
  refuse: (result: Signed) => string | null;
  onSignedIn: (result: Signed) => void;
  /** Back to the first step; `message` is set when the account was refused. */
  onBack: (message?: string) => void;
}> = ({ token, refuse, onSignedIn, onBack }) => {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await verifyMfa(token, code.trim());
      const refused = refuse(result);
      if (refused) {
        clearSession();
        onBack(refused);
        return;
      }
      onSignedIn(result);
    } catch (err: any) {
      setError(err.message || 'Incorrect verification code. Check your authenticator app and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && (
        <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
          {error}
        </Alert>
      )}
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
        <TextField
          label="Authenticator Code"
          placeholder="123456"
          value={code}
          onChange={e => setCode(e.target.value)}
          fullWidth
          autoFocus
          slotProps={{ htmlInput: { maxLength: 6, style: { letterSpacing: 6, fontWeight: 700, textAlign: 'center', fontSize: '1.25rem' } } }}
        />
        <Button type="submit" variant="contained" size="large" fullWidth disabled={busy || code.trim().length !== 6} sx={{ py: 1.3, borderRadius: 2, fontWeight: 700, textTransform: 'none' }}>
          Verify Code
        </Button>
        <Link component="button" type="button" variant="body2" onClick={() => onBack()} sx={{ color: '#0B7A3E', fontWeight: 600 }}>
          ← Back to sign in
        </Link>
      </Stack>
    </form>
  );
};
