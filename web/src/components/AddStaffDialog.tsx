import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Stack, Typography
} from '@mui/material';
import { createStaffUser } from '../api/users';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  orgNodeId: string | null;
}

// P-1 — adds a colleague to the SAME organisation as orgNodeId: same
// role, same device pool, no new hierarchy branch (Web_App_Pending_Items.md
// §8.1.2). Deliberately no role picker — staff inherit the org's role.
export const AddStaffDialog: React.FC<Props> = ({ open, onClose, onCreated, orgNodeId }) => {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setPhone('');
      setPassword('');
    }
  }, [open]);

  const needsPasswordField = user ? ['superadmin', 'manufacturer', 'distributor'].includes(user.role) : false;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!orgNodeId) return;
    if (!name.trim() || !phone.trim()) {
      showToast('Name and phone number are required', true);
      return;
    }
    setBusy(true);
    try {
      await createStaffUser({
        full_name: name.trim(),
        phone_number: phone.trim(),
        parent_user_id: orgNodeId,
        password: password.trim() || undefined
      });
      showToast(`Staff account "${name}" added — shares this organisation's device pool`);
      onCreated();
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Could not add staff account', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <form onSubmit={submit}>
        <DialogTitle>Add Staff Login</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            A staff login shares this organisation's full device pool and role — it is a colleague, not a subordinate
            tier. Every staff login has the same permissions as the account owner; there is no read-only tier yet.
          </Typography>
          <Stack spacing={2}>
            <TextField label="Full name" value={name} onChange={e => setName(e.target.value)} required fullWidth autoFocus />
            <TextField label="Mobile phone (E.164 format)" placeholder="+91 XXXXX XXXXX" value={phone} onChange={e => setPhone(e.target.value)} required fullWidth />
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
            Add staff
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};
