import React, { useEffect, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { resetPassword } from '../api/phoneVerification';
import { PhoneVerifyField } from './PhoneVerifyField';

// Mirrors the server's rule for a new password.
const MIN_PASSWORD = 8;

interface Props {
  open: boolean;
  onClose: () => void;
  /** The number typed on the sign-in form, if any. */
  initialPhone?: string;
  /** Called after the password changed, with the number it changed for. */
  onDone: (phone: string) => void;
}

/** Forgot password: prove the phone with a WhatsApp code, choose a new password, and every session of the account ends. */
export const ResetPasswordDialog: React.FC<Props> = ({ open, onClose, initialPhone = '', onDone }) => {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ticket, setTicket] = useState<string | null>(null);
  const [verifyReset, setVerifyReset] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPhone(initialPhone);
      setPassword('');
      setConfirm('');
      setTicket(null);
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!ticket) {
      setError('Verify your mobile number first: send the WhatsApp code and enter it.');
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Choose a password of at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await resetPassword(phone, ticket, password);
      onDone(phone.trim());
    } catch (err: any) {
      setError(err.message || 'Could not reset the password.');
      // The code was spent by the attempt: ask for a fresh one.
      setVerifyReset(n => n + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth slotProps={{ paper: { sx: { borderRadius: 3, p: 1 } } }}>
      <form onSubmit={submit}>
        <DialogTitle sx={{ fontWeight: 800, fontSize: '1.2rem', pb: 1 }}>Reset password</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2, lineHeight: 1.55 }}>
            We send a one-time code to your registered mobile number on WhatsApp. After you set a new password, every device
            signed in to your account is signed out.
          </Typography>
          <Stack spacing={2}>
            <TextField
              label="Registered mobile number"
              placeholder="+91 XXXXX XXXXX"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              type="tel"
              required
              fullWidth
              disabled={busy}
            />
            <PhoneVerifyField purpose="password_reset" phone={phone} onTicket={setTicket} disabled={busy} resetKey={verifyReset} />
            <TextField
              label={`New password (at least ${MIN_PASSWORD} characters)`}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              fullWidth
              disabled={busy}
            />
            <TextField
              label="Confirm new password"
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              fullWidth
              disabled={busy}
            />
            {error && (
              <Typography variant="body2" color="error" role="alert">
                {error}
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} sx={{ textTransform: 'none', fontWeight: 600 }}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={busy || !ticket} sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2 }}>
            Set new password
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};
