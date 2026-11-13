import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Stack, FormControl, InputLabel, Select, MenuItem, Alert
} from '@mui/material';
import { createPartnerByQr, ASSIGNABLE_ROLES, ROLE_NAMES, type PartnerClaim } from '../api/users';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { PartnerQrCard } from './PartnerQrCard';
import type { RoleTier } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  /** Pre-selected default role and parent, when opened from a specific tree node. */
  underRole?: RoleTier | null;
  /** With `underRole`: add exactly that level and do not offer a choice (the Distributors tab adds distributors, the Dealers tab dealers). */
  lockRole?: boolean;
  parentId?: string | null;
  parentPath?: string | null;
}

/** Add a distributor or a dealer by name and mobile number. No password, no code by WhatsApp or SMS: the dialog then shows a one-time QR to hand over.
 *  They open it, type the same number and choose their own password. */
export const AddSubordinateDialog: React.FC<Props> = ({ open, onClose, onCreated, underRole, lockRole, parentId, parentPath }) => {
  const { user } = useAuth();
  const { showToast } = useToast();
  // Farmers are registered on the Farmers page (with their starter), so this dialog offers distributors and dealers only.
  const assignable: RoleTier[] = user ? ASSIGNABLE_ROLES[user.role].filter(r => r !== 'customer') : [];

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<RoleTier | ''>('');
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ name: string; phone: string; role: RoleTier; claim: PartnerClaim } | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setPhone('');
      setMade(null);
      setRole(underRole && assignable.includes(underRole) ? underRole : assignable[0] || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, underRole]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim() || !role) {
      showToast('Name, mobile number and role are all required', true);
      return;
    }
    if (phone.replace(/\D/g, '').slice(-10).length !== 10) {
      showToast('Enter a 10-digit mobile number', true);
      return;
    }
    setBusy(true);
    try {
      const res = await createPartnerByQr({
        full_name: name.trim(),
        phone_number: phone.trim(),
        role: role as RoleTier,
        parent_user_id: parentId || undefined,
        parent_hierarchy_path: parentPath || undefined
      });
      setMade({ name: name.trim(), phone: phone.trim(), role: role as RoleTier, claim: res.claim });
      onCreated();
    } catch (err: any) {
      showToast(err.message || 'Could not create account', true);
    } finally {
      setBusy(false);
    }
  }

  if (assignable.length === 0) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      {made ? (
        <>
          <DialogTitle>{made.name} is added</DialogTitle>
          <DialogContent>
            <Alert severity="success" sx={{ mb: 2 }}>
              Give them this QR (print it, or copy the link and send it on WhatsApp). It is shown only now.
            </Alert>
            <PartnerQrCard name={made.name} phone={made.phone} roleLabel={ROLE_NAMES[made.role]} claim={made.claim} />
          </DialogContent>
          <DialogActions>
            <Button variant="contained" onClick={onClose}>
              Done
            </Button>
          </DialogActions>
        </>
      ) : (
        <form onSubmit={submit}>
          <DialogTitle>{lockRole && role ? `Add ${ROLE_NAMES[role as RoleTier].toLowerCase()}` : 'Add distributor or dealer'}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField label="Full name" placeholder="e.g. Suresh Patil" value={name} onChange={e => setName(e.target.value)} required fullWidth />
              <TextField
                label="Mobile number"
                placeholder="98765 43210"
                helperText="They will type this same number when they open the QR."
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
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={busy}>
              Add and show QR
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
};
