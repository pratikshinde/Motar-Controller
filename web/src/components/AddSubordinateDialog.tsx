import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Stack, FormControl, InputLabel, Select, MenuItem
} from '@mui/material';
import { createSubordinateUser, ASSIGNABLE_ROLES, ROLE_NAMES } from '../api/users';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { RoleTier } from '../types';

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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setPhone('');
      setPassword('');
      setRole(underRole && assignable.includes(underRole) ? underRole : assignable[0] || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, underRole]);

  const needsPasswordField = user ? ['superadmin', 'manufacturer', 'distributor'].includes(user.role) : false;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim() || !role) {
      showToast('Name, phone number and role are all required', true);
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
        password: password.trim() || undefined
      });
      showToast(`Subordinate account "${name}" created successfully`);
      onCreated();
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Could not create account', true);
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
            {needsPasswordField && (
              <TextField
                label="Password (admin-tier accounts only)"
                type="password"
                placeholder="Leave blank for OTP-only login"
                value={password}
                onChange={e => setPassword(e.target.value)}
                fullWidth
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={busy}>
            Create account
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};
