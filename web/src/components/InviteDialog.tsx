import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Stack, FormControl, InputLabel, Select, MenuItem, Typography, IconButton, Tooltip
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { createInvite } from '../api/invites';
import { ASSIGNABLE_ROLES, ROLE_NAMES } from '../api/users';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { RoleTier } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  underRole?: RoleTier | null;
  parentId?: string | null;
}

// FR-WEB-035 — a shareable self-registration link, as an alternative to
// AddSubordinateDialog (where the parent types the new account's details
// in themselves). Same role-assignment rules as that dialog — the backend
// re-enforces regardless — this just offers the other workflow.
export const InviteDialog: React.FC<Props> = ({ open, onClose, underRole, parentId }) => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const assignable = user ? ASSIGNABLE_ROLES[user.role] : [];

  const [role, setRole] = useState<RoleTier | ''>('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  useEffect(() => {
    if (open) {
      setRole(underRole && assignable.includes(underRole) ? underRole : assignable[0] || '');
      setLink('');
      setExpiresAt('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, underRole]);

  async function handleGenerate() {
    if (!role) return;
    setBusy(true);
    try {
      const result = await createInvite(role as RoleTier, parentId || undefined);
      setLink(`${window.location.origin}/invite/${result.token}`);
      setExpiresAt(result.expires_at);
    } catch (err: any) {
      showToast(err.message || 'Could not create invite link', true);
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(link);
      showToast('Link copied to clipboard');
    } catch {
      showToast('Could not copy — select and copy the link manually', true);
    }
  }

  if (assignable.length === 0) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Invite via Link</DialogTitle>
      <DialogContent>
        {!link ? (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              The invited person registers themselves — their own phone number and password — using this link. It
              works once and expires in 7 days.
            </Typography>
            <FormControl fullWidth required>
              <InputLabel id="invite-role-label">Account role</InputLabel>
              <Select labelId="invite-role-label" label="Account role" value={role} onChange={e => setRole(e.target.value as RoleTier)}>
                {assignable
                  .filter(r => r !== 'superadmin')
                  .map(r => (
                    <MenuItem key={r} value={r}>
                      {ROLE_NAMES[r]}
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Share this link — it's shown once. Expires {new Date(expiresAt).toLocaleString()}.
            </Typography>
            <TextField
              value={link}
              fullWidth
              size="small"
              slotProps={{
                htmlInput: { readOnly: true },
                input: {
                  endAdornment: (
                    <Tooltip title="Copy link">
                      <IconButton size="small" onClick={handleCopy}>
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )
                }
              }}
            />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{link ? 'Done' : 'Cancel'}</Button>
        {!link && (
          <Button variant="contained" onClick={handleGenerate} disabled={busy || !role}>
            Generate link
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};
