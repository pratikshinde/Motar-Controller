import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import { resendAdminInvite, startAdminInvite, verifyAdminInvite, type AdminInvite } from '../api/adminInvites';
import { useToast } from '../context/ToastContext';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Something changed that the page behind should show (an admin was started or finished). */
  onCreated: () => void;
}

/**
 * Register an admin: only the admin's name, their company, address, phone (an Indian number: +91 is fixed) and email. Then "Verify email" sends a 6-digit code to
 * that address from the platform; the admin reads it out, the platform owner types it here, and only then is the admin (and their company, as a manufacturer)
 * registered. The admin then opens the website's Admin sign-in and chooses their own password.
 */
export const AddManufacturerDialog: React.FC<Props> = ({ open, onClose, onCreated }) => {
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [invite, setInvite] = useState<AdminInvite | null>(null);
  const [code, setCode] = useState('');
  const [added, setAdded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName('');
    setCompany('');
    setAddress('');
    setPhone('');
    setEmail('');
    setInvite(null);
    setCode('');
    setAdded(false);
    setBusy(false);
    setError('');
  }, [open]);

  const digits = phone.replace(/\D/g, '');

  async function verifyEmail(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim() || !company.trim() || !address.trim() || !email.trim()) return setError('Fill in all five details.');
    if (digits.length !== 10) return setError('Enter the 10-digit phone number (the +91 is added for you).');
    setBusy(true);
    try {
      const res = await startAdminInvite({ full_name: name.trim(), company_name: company.trim(), address: address.trim(), phone: digits, email: email.trim() });
      setInvite(res.invite);
      setCode('');
      onCreated();
    } catch (err: any) {
      setError(err.message || 'Could not send the code.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!invite) return;
    setError('');
    setBusy(true);
    try {
      await verifyAdminInvite(invite.id, code);
      setAdded(true);
      onCreated();
    } catch (err: any) {
      setError(err.message || 'That code is not right.');
    } finally {
      setBusy(false);
    }
  }

  async function sendAgain() {
    if (!invite) return;
    setError('');
    setBusy(true);
    try {
      setInvite((await resendAdminInvite(invite.id)).invite);
      setCode('');
      showToast(`A new code was sent to ${invite.email}`);
    } catch (err: any) {
      setError(err.message || 'Could not send a new code.');
    } finally {
      setBusy(false);
    }
  }

  if (added && invite) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>{invite.full_name} is registered</DialogTitle>
        <DialogContent>
          <Alert severity="success" data-testid="admin-added">
            {invite.company_name} is added and so is its admin. Tell {invite.full_name.split(' ')[0]} to open the website, choose Login, then Admin, then “First time here”, and type their
            email ({invite.email}), the same code from their email, and a password of their own. After that they sign in with the email and that password. The code is never needed
            again.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={onClose}>
            Done
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  const waiting = !!invite;
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <form onSubmit={waiting ? confirm : verifyEmail}>
        <DialogTitle>Register admin</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Admin name" placeholder="e.g. Meera Joshi" value={name} onChange={e => setName(e.target.value)} required fullWidth disabled={busy || waiting} autoFocus />
            <TextField label="Company name" placeholder="e.g. Swati Pumps Pvt Ltd" value={company} onChange={e => setCompany(e.target.value)} required fullWidth disabled={busy || waiting} />
            <TextField label="Address" placeholder="Town, taluka, district, state" value={address} onChange={e => setAddress(e.target.value)} required fullWidth multiline minRows={2} disabled={busy || waiting} />
            <TextField
              label="Phone number"
              placeholder="98765 43210"
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              required
              fullWidth
              disabled={busy || waiting}
              slotProps={{ input: { startAdornment: <InputAdornment position="start">+91</InputAdornment> } }}
            />
            <TextField label="Email" type="email" placeholder="name@company.com" value={email} onChange={e => setEmail(e.target.value)} required fullWidth disabled={busy || waiting} />

            {waiting && (
              <>
                <Alert severity="info" data-testid="code-sent">
                  A 6-digit code was sent to {invite!.email}. Ask them to read it out to you, and type it here. It works for 24 hours. If it is not in their inbox, ask them to check Spam.
                </Alert>
                <TextField
                  label="Code the admin read out"
                  placeholder="123456"
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  autoFocus
                  fullWidth
                  slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6, style: { letterSpacing: 6, fontWeight: 700, fontSize: '1.2rem' } } }}
                />
              </>
            )}
            {error && <Alert severity="error">{error}</Alert>}
            {!waiting && (
              <Typography variant="caption" color="text.secondary">
                Nothing is registered until the admin’s email is confirmed with the code.
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          {waiting ? (
            <>
              <Button onClick={sendAgain} disabled={busy} data-testid="send-again">
                Send a new code
              </Button>
              <Box sx={{ flex: 1 }} />
              <Button onClick={onClose} disabled={busy}>
                Later
              </Button>
              <Button type="submit" variant="contained" disabled={busy || code.trim().length !== 6}>
                Confirm and register
              </Button>
            </>
          ) : (
            <>
              <Button onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" variant="contained" disabled={busy} data-testid="verify-email">
                {busy ? 'Sending…' : 'Verify email'}
              </Button>
            </>
          )}
        </DialogActions>
      </form>
    </Dialog>
  );
};
