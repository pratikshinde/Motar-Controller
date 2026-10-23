import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Stack, FormControl, InputLabel, Select, MenuItem
} from '@mui/material';
import { createSubordinateUser, ASSIGNABLE_ROLES, ROLE_NAMES } from '../api/users';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { PhoneVerifyField } from './PhoneVerifyField';
import type { RoleTier } from '../types';

// Mirrors MIN_PARTNER_PASSWORD on the server.
const MIN_PASSWORD = 8;

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  /** Pre-selected default role and parent, when opened from a specific tree node. */
  underRole?: RoleTier | null;
  parentId?: string | null;
  parentPath?: string | null;
}

export const AddSubordinateDialog: React.FC<Props> = ({ open, onClose, onCreated, underRole, parentId, parentPath }) => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const assignable = user ? ASSIGNABLE_ROLES[user.role] : [];

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<RoleTier | ''>('');
  const [password, setPassword] = useState('');
  const [ticket, setTicket] = useState<string | null>(null);
  const [verifyReset, setVerifyReset] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setPhone('');
      setPassword('');
      setTicket(null);
      setRole(underRole && assignable.includes(underRole) ? underRole : assignable[0] || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, underRole]);

  // A farmer signs in with an SMS code and needs no password; every partner account signs in with one (the server
  // refuses a partner account without it).
  const passwordRequired = role !== '' && role !== 'customer';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim() || !role) {
      showToast('Name, phone number and role are all required', true);
      return;
    }
    if (!ticket) {
      showToast('Verify the mobile number first: send the WhatsApp code and enter what the person reads out', true);
      return;
    }
    if (passwordRequired && password.trim().length < MIN_PASSWORD) {
      showToast(`A password of at least ${MIN_PASSWORD} characters is required for this role`, true);
      return;
    }
    setBusy(true);
    try {
      await createSubordinateUser({
        full_name: name.trim(),
        phone_number: phone.trim(),
        role: role as RoleTier,
        parent_user_id: parentId || undefined,
        parent_hierarchy_path: parentPath || undefined,
        password: password.trim() || undefined,
        phone_verification_token: ticket
      });
      showToast(`Subordinate account "${name}" created successfully`);
      onCreated();
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Could not create account', true);
      // The server may have spent the ticket before it refused; ask for a fresh code.
      setVerifyReset(n => n + 1);
    } finally {
      setBusy(false);
    }
  }

  if (assignable.length === 0) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <form onSubmit={submit}>
        <DialogTitle>Add Subordinate Account</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Full name" placeholder="e.g. Suresh Technician" value={name} onChange={e => setName(e.target.value)} required fullWidth />
            <TextField label="Mobile phone (E.164 format)" placeholder="+91 XXXXX XXXXX" value={phone} onChange={e => setPhone(e.target.value)} required fullWidth />
            <PhoneVerifyField
              phone={phone}
              onTicket={setTicket}
              disabled={busy}
              resetKey={verifyReset}
              hint="A one-time code goes to this number on WhatsApp. Ask the person to read it out to you."
            />
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
            {passwordRequired && (
              <TextField
                label={`Password (at least ${MIN_PASSWORD} characters)`}
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                fullWidth
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={busy || !ticket}>
            Create account
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};
