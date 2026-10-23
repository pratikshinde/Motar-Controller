import React, { useEffect, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Stack, TextField, Typography } from '@mui/material';
import { createManufacturerAccount, createManufacturerBrand } from '../api/brands';
import { PhoneVerifyField } from './PhoneVerifyField';
import { useToast } from '../context/ToastContext';

// Mirrors the server (MIN_PARTNER_PASSWORD, KEY_PATTERN, the #RRGGBB check).
const MIN_PASSWORD = 8;
const KEY_RE = /^[a-z][a-z0-9-]{1,29}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(pump|pumps|controller|controllers|private|pvt|ltd|limited)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (key: string) => void;
}

/**
 * Onboards a new manufacturer in two steps the server takes one call each for: the manufacturer itself (name, colour,
 * support contact: what its farmers' app shows) and then its own login, which becomes the owner of everything the
 * manufacturer later creates (distributors, dealers, farmers, pumps).
 */
export const AddManufacturerDialog: React.FC<Props> = ({ open, onClose, onCreated }) => {
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [color, setColor] = useState('');
  const [supportPhone, setSupportPhone] = useState('');
  const [supportEmail, setSupportEmail] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [ticket, setTicket] = useState<string | null>(null);
  const [verifyReset, setVerifyReset] = useState(0);
  const [brandDone, setBrandDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName('');
    setKey('');
    setKeyEdited(false);
    setColor('');
    setSupportPhone('');
    setSupportEmail('');
    setOwnerName('');
    setPhone('');
    setPassword('');
    setTicket(null);
    setBrandDone(false);
    setError('');
  }, [open]);

  function onName(v: string) {
    setName(v);
    if (!keyEdited) setKey(slug(v));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!brandDone) {
      if (name.trim().length < 2) return setError('Enter the manufacturer’s name.');
      if (!KEY_RE.test(key)) return setError('The short key must be 2–30 lowercase letters, digits or dashes, starting with a letter.');
      if (color && !COLOR_RE.test(color)) return setError('The colour must look like #1B4FB8.');
    }
    if (!ownerName.trim() || !phone.trim()) return setError('The manufacturer’s login needs a name and a mobile number.');
    if (!ticket) return setError('Verify the mobile number first: send the WhatsApp code and enter what the person reads out.');
    if (password.length < MIN_PASSWORD) return setError(`The password must be at least ${MIN_PASSWORD} characters.`);

    setBusy(true);
    try {
      if (!brandDone) {
        await createManufacturerBrand({
          key,
          name: name.trim(),
          short_name: name.trim().split(/\s+/)[0].toUpperCase().slice(0, 30),
          ...(color ? { primary_color: color } : {}),
          ...(supportPhone.trim() ? { support_phone: supportPhone.trim() } : {}),
          ...(supportEmail.trim() ? { support_email: supportEmail.trim() } : {})
        });
        setBrandDone(true);
      }
      await createManufacturerAccount({
        brand: key,
        full_name: ownerName.trim(),
        phone_number: phone.trim(),
        password,
        phone_verification_token: ticket
      });
      showToast(`${name.trim()} added. They can sign in to the web portal now.`);
      onCreated(key);
      onClose();
    } catch (err: any) {
      // The manufacturer itself may already exist when the login step fails: keep that, retry only the login.
      setError(err.message || 'Could not add the manufacturer.');
      setVerifyReset(n => n + 1);
      setTicket(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <form onSubmit={submit}>
        <DialogTitle>Add manufacturer</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {brandDone && (
              <Alert severity="info">
                {name} has been created. Only its login is left: fix the details below and try again.
              </Alert>
            )}
            <Typography variant="subtitle2">The manufacturer</Typography>
            <TextField label="Name" placeholder="e.g. Swati Pump Controller" value={name} onChange={e => onName(e.target.value)} required fullWidth disabled={busy || brandDone} />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Short key"
                helperText="Used by its farmers’ app. Cannot be changed later."
                value={key}
                onChange={e => {
                  setKeyEdited(true);
                  setKey(e.target.value.toLowerCase());
                }}
                required
                fullWidth
                disabled={busy || brandDone}
              />
              <TextField label="Brand colour" placeholder="#1B4FB8" value={color} onChange={e => setColor(e.target.value)} fullWidth disabled={busy || brandDone} />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Support phone" placeholder="+91…" value={supportPhone} onChange={e => setSupportPhone(e.target.value)} fullWidth disabled={busy || brandDone} />
              <TextField label="Support email" value={supportEmail} onChange={e => setSupportEmail(e.target.value)} fullWidth disabled={busy || brandDone} />
            </Stack>

            <Divider />
            <Typography variant="subtitle2">The manufacturer’s login to this portal</Typography>
            <TextField label="Full name" value={ownerName} onChange={e => setOwnerName(e.target.value)} required fullWidth disabled={busy} />
            <TextField label="Mobile number" placeholder="+91 XXXXX XXXXX" value={phone} onChange={e => setPhone(e.target.value)} required fullWidth disabled={busy} />
            <PhoneVerifyField
              phone={phone}
              onTicket={setTicket}
              disabled={busy}
              resetKey={verifyReset}
              hint="A one-time code goes to this number on WhatsApp. Ask the person to read it out to you."
            />
            <TextField
              label={`Password (at least ${MIN_PASSWORD} characters)`}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              fullWidth
              disabled={busy}
            />
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={busy || !ticket}>
            {brandDone ? 'Create login' : 'Add manufacturer'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};
