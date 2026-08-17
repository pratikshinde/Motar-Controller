import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Typography, Box, CircularProgress, Stack
} from '@mui/material';
import { QRCodeSVG } from 'qrcode.react';
import { setupMfa, enableMfa } from '../api/mfa';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { monoFont } from '../theme';

// FR-WEB-001 — MFA is mandatory for superadmin and manufacturer roles.
// Deliberately has no dismiss/skip path: no onClose handler, so a
// backdrop click or Escape does nothing. This is a UX enforcement, not a
// security boundary — a stuck account is recoverable at the database —
// but "mandatory" should behave as mandatory rather than as a dismissable
// suggestion.
export const MfaSetupDialog: React.FC = () => {
  const { mfaSetupRequired, clearMfaSetupRequired } = useAuth();
  const { showToast } = useToast();

  const [secret, setSecret] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!mfaSetupRequired) return;
    setLoading(true);
    setupMfa()
      .then(res => {
        setSecret(res.secret);
        setOtpauthUrl(res.otpauth_url);
      })
      .catch(err => showToast(err.message || 'Could not start MFA setup', true))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mfaSetupRequired]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await enableMfa(code.trim());
      showToast('MFA enabled — your account is now protected with a second factor');
      clearMfaSetupRequired();
    } catch (err: any) {
      setError(err.message || 'Incorrect code');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={mfaSetupRequired} maxWidth="xs" fullWidth>
      <DialogTitle>Set up two-factor authentication</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Your account role requires MFA before you can continue. Scan this code with an authenticator app (Google
          Authenticator, Authy, or similar).
        </Typography>

        {loading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <form onSubmit={handleSubmit}>
            <Stack spacing={2} sx={{ alignItems: 'center' }}>
              {otpauthUrl && (
                <Box sx={{ p: 2, bgcolor: '#fff', borderRadius: 2 }}>
                  <QRCodeSVG value={otpauthUrl} size={180} />
                </Box>
              )}
              <Typography variant="caption" color="text.secondary">
                Can't scan? Enter this key manually:
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: monoFont, letterSpacing: 1, userSelect: 'all', textAlign: 'center' }}>
                {secret}
              </Typography>

              {error && (
                <Typography variant="body2" color="error">
                  {error}
                </Typography>
              )}

              <TextField
                label="6-digit code"
                placeholder="123456"
                value={code}
                onChange={e => setCode(e.target.value)}
                fullWidth
                autoFocus
                slotProps={{ htmlInput: { maxLength: 6, style: { letterSpacing: 4, fontWeight: 700, textAlign: 'center' } } }}
              />
              <Button type="submit" variant="contained" fullWidth disabled={busy || code.trim().length !== 6}>
                Enable MFA
              </Button>
            </Stack>
          </form>
        )}
      </DialogContent>
      <DialogActions />
    </Dialog>
  );
};
