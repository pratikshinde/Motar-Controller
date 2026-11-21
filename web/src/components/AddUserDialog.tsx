import React, { useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import { createSubordinateUser } from '../api/users';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after a user was added, so the list can refresh. */
  onCreated: () => void;
}

export const MIN_USER_PASSWORD = 8;
const tenDigits = (raw: string) => raw.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');

/** Add a user for a brand whose admin adds its users directly (SolarLogger): a name, the mobile number and a password. The admin hands the number and the
 *  password over, and the user signs in with them in the app. There is no SMS and no QR. */
export const AddUserDialog: React.FC<Props> = ({ open, onClose, onCreated }) => {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; phone: string; password: string } | null>(null);

  const reset = () => {
    setFullName('');
    setPhone('');
    setPassword('');
    setError(null);
    setDone(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    const digits = tenDigits(phone);
    if (fullName.trim().length < 2) return setError("Enter the user's name.");
    if (!/^[6-9]\d{9}$/.test(digits)) return setError('Enter a 10-digit mobile number.');
    if (password.length < MIN_USER_PASSWORD) return setError(`Choose a password of at least ${MIN_USER_PASSWORD} characters.`);
    setBusy(true);
    try {
      await createSubordinateUser({ full_name: fullName.trim(), phone_number: digits, role: 'customer', password });
      setDone({ name: fullName.trim(), phone: digits, password });
      onCreated();
    } catch (err: any) {
      setError(err?.message || 'Could not add the user.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : close} fullWidth maxWidth="xs">
      <DialogTitle>{done ? 'User added' : 'Add user'}</DialogTitle>
      {done ? (
        <>
          <DialogContent>
            <Stack spacing={1.5} data-testid="user-added">
              <Alert severity="success">{done.name} can now sign in to the app.</Alert>
              <Typography variant="body2">Give them these to sign in. The password is shown only now.</Typography>
              <Typography sx={{ fontFamily: 'monospace' }}>Mobile: {done.phone}</Typography>
              <Typography sx={{ fontFamily: 'monospace' }}>Password: {done.password}</Typography>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={reset}>Add another</Button>
            <Button variant="contained" onClick={close}>
              Done
            </Button>
          </DialogActions>
        </>
      ) : (
        <form onSubmit={submit}>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 0.5 }}>
              {error && <Alert severity="error">{error}</Alert>}
              <TextField label="Name" value={fullName} onChange={e => setFullName(e.target.value)} autoFocus required fullWidth />
              <TextField
                label="Mobile number"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="98765 43210"
                slotProps={{ htmlInput: { inputMode: 'tel', maxLength: 16 }, input: { startAdornment: <InputAdornment position="start">+91</InputAdornment> } }}
                required
                fullWidth
              />
              <TextField
                label="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                helperText={`At least ${MIN_USER_PASSWORD} characters. You give it to the user.`}
                slotProps={{ htmlInput: { autoComplete: 'off' } }}
                required
                fullWidth
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={busy}>
              {busy ? 'Adding…' : 'Add user'}
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
};
