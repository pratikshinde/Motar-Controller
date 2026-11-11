import React, { useEffect, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import { updateFarmer, type FarmerRow } from '../api/farmers';

interface Props {
  farmer: FarmerRow | null;
  onClose: () => void;
  onSaved: () => void;
}

const tenDigits = (raw: string) => raw.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');

/** Fix a farmer's name, address or mobile number. Only what was changed is sent. */
export const EditFarmerDialog: React.FC<Props> = ({ farmer, onClose, onSaved }) => {
  const [fullName, setFullName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!farmer) return;
    setFullName(farmer.full_name);
    setAddress(farmer.address ?? '');
    setPhone(tenDigits(farmer.phone_number));
    setError(null);
  }, [farmer]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!farmer) return;
    setError(null);
    const changes: { full_name?: string; address?: string; phone?: string } = {};
    if (fullName.trim() !== farmer.full_name) changes.full_name = fullName.trim();
    if (address.trim() !== (farmer.address ?? '')) changes.address = address.trim();
    const digits = tenDigits(phone);
    if (digits !== tenDigits(farmer.phone_number)) changes.phone = digits;

    if (changes.full_name !== undefined && changes.full_name.length < 2) return setError("Enter the farmer's name.");
    if (changes.address !== undefined && changes.address.length < 3) return setError("Enter the farmer's address.");
    if (changes.phone !== undefined && !/^[6-9]\d{9}$/.test(changes.phone)) return setError('Enter a 10-digit mobile number.');
    if (Object.keys(changes).length === 0) return onClose();

    setBusy(true);
    try {
      await updateFarmer(farmer.id, changes);
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not save the changes.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(farmer)} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>Edit farmer</DialogTitle>
      <form onSubmit={save}>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Farmer's name" value={fullName} onChange={e => setFullName(e.target.value)} autoFocus required fullWidth />
            <TextField label="Address" value={address} onChange={e => setAddress(e.target.value)} multiline minRows={2} required fullWidth />
            <TextField
              label="Mobile number"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              slotProps={{ htmlInput: { inputMode: 'tel', maxLength: 16 }, input: { startAdornment: <InputAdornment position="start">+91</InputAdornment> } }}
              required
              fullWidth
            />
            <Typography variant="caption" color="text.secondary">
              A farmer who has not scanned the QR yet will be asked for the new number when they do.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};
