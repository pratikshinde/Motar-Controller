import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from '@mui/material';
import { resendAdminInvite, verifyAdminInvite, type AdminInvite } from '../api/adminInvites';
import { useToast } from '../context/ToastContext';

/** Carry on with an admin who was added but whose code was not typed in yet: the code the admin read out creates their login. */
export const VerifyAdminInviteDialog: React.FC<{ invite: AdminInvite | null; onClose: () => void; onDone: () => void }> = ({ invite, onClose, onDone }) => {
  const { showToast } = useToast();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCode('');
    setError('');
  }, [invite?.id]);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!invite) return;
    setError('');
    setBusy(true);
    try {
      await verifyAdminInvite(invite.id, code);
      showToast(`${invite.full_name} is added. They can now choose their password on the Admin sign-in.`);
      onDone();
    } catch (err: any) {
      setError(err.message || 'That code is not right.');
    } finally {
      setBusy(false);
    }
  }

  async function again() {
    if (!invite) return;
    setBusy(true);
    setError('');
    try {
      await resendAdminInvite(invite.id);
      setCode('');
      showToast(`A new code was sent to ${invite.email}`);
    } catch (err: any) {
      setError(err.message || 'Could not send a new code.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!invite} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <form onSubmit={confirm}>
        <DialogTitle>Confirm {invite?.full_name}’s email</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="info">A 6-digit code was sent to {invite?.email}. Ask them to read it out to you and type it here.</Alert>
            <TextField
              label="Code the admin read out"
              placeholder="123456"
              value={code}
              onChange={e => setCode(e.target.value)}
              autoFocus
              fullWidth
              slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6, style: { letterSpacing: 6, fontWeight: 700, fontSize: '1.2rem' } } }}
            />
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={again} disabled={busy} data-testid="resend-code">
            Send a new code
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={onClose} disabled={busy}>
            Later
          </Button>
          <Button type="submit" variant="contained" disabled={busy || code.trim().length !== 6}>
            Confirm and add
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};
