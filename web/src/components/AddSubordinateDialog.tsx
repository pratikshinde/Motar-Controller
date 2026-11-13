import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Stack, FormControl, InputLabel, Select, MenuItem, Alert, Box, Typography,
  CircularProgress, Paper
} from '@mui/material';
import { QRCodeSVG } from 'qrcode.react';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { ASSIGNABLE_ROLES, ROLE_NAMES } from '../api/users';
import {
  cancelRegistration, fetchRegistration, newRegistrationPassword, newRegistrationQr, registrationLinkFor, startRegistration,
  type Registration
} from '../api/registrations';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { RoleTier } from '../types';

const POLL_MS = 2500;

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called when something changed that the page behind should show (a registration was started, finished or cancelled). */
  onCreated: () => void;
  /** Pre-selected default role and parent, when opened from a specific tree node. */
  underRole?: RoleTier | null;
  /** With `underRole`: add exactly that level and do not offer a choice (the Distributors tab adds distributors, the Dealers tab dealers). */
  lockRole?: boolean;
  parentId?: string | null;
  parentPath?: string | null;
  /** Carry on with a registration that was started earlier and is not finished: a new QR is made and the dialog follows it. */
  resume?: Registration | null;
  /** How often the page asks whether the QR was scanned (milliseconds). */
  pollMs?: number;
}

/** Register a distributor or a dealer: name, address and mobile number first. Nothing is created yet: a QR is shown, the new person scans it, the one-time
 *  password then appears here for you to send them, they type it with their mobile number and choose their own password, and only then is the account made. */
export const AddSubordinateDialog: React.FC<Props> = ({ open, onClose, onCreated, underRole, lockRole, parentId, resume, pollMs = POLL_MS }) => {
  const { user } = useAuth();
  const { showToast } = useToast();
  // Farmers are registered on the Farmers page (with their starter), so this dialog offers distributors and dealers only.
  const assignable: RoleTier[] = user ? ASSIGNABLE_ROLES[user.role].filter(r => r !== 'customer') : [];

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<RoleTier | ''>('');
  const [busy, setBusy] = useState(false);
  const [reg, setReg] = useState<Registration | null>(null);
  const [token, setToken] = useState<string | null>(null);
  // The password is shown by the server once; keep it here so the admin can read it for as long as this dialog is open.
  const [password, setPassword] = useState<string | null>(null);
  const done = useRef(false);

  const absorb = useCallback((r: Registration) => {
    setReg(r);
    if (r.password) setPassword(r.password);
    if (r.status === 'COMPLETED' && !done.current) {
      done.current = true;
      onCreated();
    }
  }, [onCreated]);

  useEffect(() => {
    if (!open) return;
    done.current = false;
    setName('');
    setAddress('');
    setPhone('');
    setReg(null);
    setToken(null);
    setPassword(null);
    setRole(underRole && assignable.includes(underRole) ? underRole : assignable[0] || '');
    if (resume) {
      // Carry on with an unfinished registration: a new QR (the old one may be gone) and the dialog follows it from the start again.
      setBusy(true);
      newRegistrationQr(resume.id)
        .then(res => {
          setToken(res.qr.token);
          absorb(res.registration);
        })
        .catch((err: any) => showToast(err?.message || 'Could not continue this registration', true))
        .finally(() => setBusy(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, underRole, resume?.id]);

  // Follow the registration: waiting for the scan, then the password to send, then done.
  useEffect(() => {
    if (!open || !reg || reg.status === 'COMPLETED' || reg.status === 'CANCELLED') return;
    const id = setInterval(async () => {
      try {
        absorb((await fetchRegistration(reg.id)).registration);
      } catch {
        // a missed poll is simply tried again
      }
    }, pollMs);
    return () => clearInterval(id);
  }, [open, reg?.id, reg?.status, absorb, pollMs]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !address.trim() || !phone.trim() || !role) {
      showToast('Name, address and mobile number are all needed', true);
      return;
    }
    if (phone.replace(/\D/g, '').slice(-10).length !== 10) {
      showToast('Enter a 10-digit mobile number', true);
      return;
    }
    setBusy(true);
    try {
      const res = await startRegistration({ full_name: name.trim(), address: address.trim(), phone_number: phone.trim(), role: role as RoleTier, parent_user_id: parentId || undefined });
      setToken(res.qr.token);
      absorb(res.registration);
      onCreated();
    } catch (err: any) {
      showToast(err?.message || 'Could not start the registration', true);
    } finally {
      setBusy(false);
    }
  }

  async function newQr() {
    if (!reg) return;
    setBusy(true);
    try {
      const res = await newRegistrationQr(reg.id);
      setToken(res.qr.token);
      setPassword(null);
      absorb(res.registration);
    } catch (err: any) {
      showToast(err?.message || 'Could not make a new QR', true);
    } finally {
      setBusy(false);
    }
  }

  async function newPassword() {
    if (!reg) return;
    setBusy(true);
    try {
      const res = await newRegistrationPassword(reg.id);
      setPassword(res.registration.password);
      absorb(res.registration);
    } catch (err: any) {
      showToast(err?.message || 'Could not make a new password', true);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (reg && reg.status !== 'COMPLETED') {
      try {
        await cancelRegistration(reg.id);
        onCreated();
      } catch {
        // already gone: nothing to cancel
      }
    }
    onClose();
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${what} copied`);
    } catch {
      showToast('Could not copy. Select it and copy it.', true);
    }
  }

  if (assignable.length === 0) return null;
  const roleName = reg ? ROLE_NAMES[reg.role as RoleTier] : role ? ROLE_NAMES[role as RoleTier] : '';
  const first = reg?.full_name.split(/\s+/)[0] ?? '';

  // ---- 1. the form
  if (!reg) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
        <form onSubmit={submit}>
          <DialogTitle>{lockRole && role ? `Register ${ROLE_NAMES[role as RoleTier].toLowerCase()}` : 'Register distributor or dealer'}</DialogTitle>
          <DialogContent>
            {busy && resume ? (
              <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
                <CircularProgress />
              </Box>
            ) : (
              <Stack spacing={2} sx={{ mt: 1 }}>
                <TextField label="Full name" placeholder="e.g. Suresh Patil" value={name} onChange={e => setName(e.target.value)} required fullWidth />
                <TextField label="Address" placeholder="Village or town, taluka, district" value={address} onChange={e => setAddress(e.target.value)} required fullWidth multiline minRows={2} />
                <TextField
                  label="Mobile number"
                  placeholder="98765 43210"
                  helperText="They will type this same number later. No account is made until they do."
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  required
                  fullWidth
                />
                {!(lockRole && role) && (
                  <FormControl fullWidth required>
                    <InputLabel id="role-select-label">Account role</InputLabel>
                    <Select labelId="role-select-label" label="Account role" value={role} onChange={e => setRole(e.target.value as RoleTier)}>
                      {assignable.map(r => (
                        <MenuItem key={r} value={r}>
                          {ROLE_NAMES[r]}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </Stack>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={busy}>
              Continue
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    );
  }

  // ---- 2. the QR, and what happens next
  const link = token ? registrationLinkFor(token) : null;
  return (
    <Dialog open={open} onClose={reg.status === 'COMPLETED' ? onClose : undefined} maxWidth="xs" fullWidth>
      <DialogTitle>
        {reg.status === 'COMPLETED' ? `${reg.full_name} is registered` : `Registering ${reg.full_name}`}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center' }} data-testid="registration-steps">
          {reg.status === 'COMPLETED' && (
            <>
              <CheckCircleIcon color="success" sx={{ fontSize: 48 }} />
              <Typography>
                {first} chose their own password and the {roleName.toLowerCase()} account is ready. They can sign in on the website with their mobile number.
              </Typography>
            </>
          )}

          {(reg.status === 'WAITING' || reg.status === 'SCANNED') && link && (
            <>
              <Box sx={{ bgcolor: '#fff', p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', lineHeight: 0, opacity: reg.status === 'SCANNED' ? 0.45 : 1 }}>
                <QRCodeSVG value={link} size={190} level="M" />
              </Box>
              <Typography variant="caption" sx={{ wordBreak: 'break-all', fontFamily: 'monospace' }} data-testid="registration-link">
                {link}
              </Typography>
            </>
          )}

          {reg.status === 'WAITING' && (
            <Alert severity="info" icon={<CircularProgress size={18} />} sx={{ width: '100%', textAlign: 'left' }} data-testid="waiting-for-scan">
              Ask {first} to scan this QR with their phone camera. This page shows the password as soon as they do.
            </Alert>
          )}

          {reg.status === 'SCANNED' && (
            <Box sx={{ width: '100%' }} data-testid="scanned">
              <Alert severity="success" sx={{ textAlign: 'left', mb: 1.5 }}>
                {first} scanned the QR. Send them this password now.
              </Alert>
              {password ? (
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
                  <Typography variant="caption" color="text.secondary">
                    Password for {reg.full_name} ({reg.phone_number})
                  </Typography>
                  <Typography data-testid="one-time-password" sx={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '2rem', letterSpacing: 3, my: 0.5 }}>
                    {password}
                  </Typography>
                  <Button size="small" startIcon={<ContentCopyIcon />} onClick={() => copy(password, 'Password')}>
                    Copy
                  </Button>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                    They type their mobile number and this password on the page that opened, then choose their own password. It works once.
                  </Typography>
                </Paper>
              ) : (
                <Alert severity="warning" sx={{ textAlign: 'left' }} action={<Button size="small" onClick={newPassword} disabled={busy}>New password</Button>}>
                  The password is shown only once and this page missed it. Make a new one.
                </Alert>
              )}
            </Box>
          )}

          {reg.status === 'EXPIRED' && (
            <Alert severity="warning" sx={{ width: '100%', textAlign: 'left' }}>
              This QR has expired. Make a new one.
            </Alert>
          )}
          {reg.status === 'BLOCKED' && (
            <Alert severity="error" sx={{ width: '100%', textAlign: 'left' }}>
              Too many wrong tries, so this QR is blocked. Make a new one.
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {reg.status === 'COMPLETED' ? (
          <Button variant="contained" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button color="inherit" onClick={cancel}>
              Cancel registration
            </Button>
            <Box sx={{ flex: 1 }} />
            {(reg.status === 'EXPIRED' || reg.status === 'BLOCKED' || reg.status === 'WAITING' || reg.status === 'SCANNED') && (
              <Button onClick={newQr} disabled={busy} data-testid="new-qr-button">
                New QR
              </Button>
            )}
            {reg.status === 'SCANNED' && password && (
              <Button onClick={newPassword} disabled={busy}>
                New password
              </Button>
            )}
            <Button variant="contained" onClick={onClose}>
              Close
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};
