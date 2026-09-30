import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Stack, FormControl, InputLabel, Select, MenuItem, Typography, Box,
  List, ListItem, ListItemText, Chip, Divider
} from '@mui/material';
import { fetchUserTree, ROLE_NAMES } from '../api/users';
import { bulkAllocatePumps, type BulkAllocateResult } from '../api/pumps';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { monoFont } from '../theme';
import type { UserTreeNode } from '../types';

interface FlatAccount {
  id: string;
  label: string;
  role: string;
}

function flattenTree(nodes: UserTreeNode[]): FlatAccount[] {
  const out: FlatAccount[] = [];
  function walk(list: UserTreeNode[]) {
    for (const node of list) {
      for (const member of node.members) {
        out.push({ id: member.id, role: member.role, label: `${member.full_name} — ${ROLE_NAMES[member.role]} — ${member.phone_number}` });
      }
      if (node.children?.length) walk(node.children);
    }
  }
  walk(nodes);
  return out;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onAllocated: () => void;
  pumpIds: string[];
}

// FR-WEB-013/030 — bulk stock allocation: reassign ownership of every
// selected device to one target account in a single request. The target
// list is every account in the caller's own hierarchy (superadmin sees
// everyone) — the backend enforces "child nodes only" for non-superadmin
// callers regardless of what's offered here.
export const AllocateDialog: React.FC<Props> = ({ open, onClose, onAllocated, pumpIds }) => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [accounts, setAccounts] = useState<FlatAccount[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkAllocateResult | null>(null);
  // Frozen at open time: onAllocated may clear the caller's selection while
  // this dialog is still showing the result, and pumpIds is a live prop —
  // without this the heading would flip to "0 Devices" right after success.
  const [openedWithCount, setOpenedWithCount] = useState(0);

  useEffect(() => {
    if (open) {
      setTargetId('');
      setNote('');
      setResult(null);
      setAccountsLoaded(false);
      setOpenedWithCount(pumpIds.length);
      fetchUserTree()
        // The server refuses the caller itself and the platform owner as a target, so do not offer them.
        .then(data => setAccounts(flattenTree(data.tree).filter(a => a.id !== user?.id && a.role !== 'superadmin')))
        .catch(err => showToast(err.message || 'Could not load accounts', true))
        .finally(() => setAccountsLoaded(true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!targetId) {
      showToast('Choose a target account', true);
      return;
    }
    setBusy(true);
    try {
      const res = await bulkAllocatePumps(pumpIds, targetId, note.trim() || undefined);
      setResult(res);
      const successCount = res.results.filter(r => r.success).length;
      if (successCount > 0) {
        showToast(res.message);
        onAllocated();
      }
    } catch (err: any) {
      showToast(err.message || 'Allocation failed', true);
    } finally {
      setBusy(false);
    }
  }

  function handleClose() {
    if (result && result.results.some(r => r.success)) onAllocated();
    onClose();
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <form onSubmit={submit}>
        <DialogTitle>Allocate {openedWithCount} Device{openedWithCount === 1 ? '' : 's'}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Reassigns ownership and hierarchy scope for every selected device to the target account. Recorded in the
            allocation history for each device.
          </Typography>
          {accountsLoaded && accounts.length === 0 && (
            <Typography variant="body2" color="warning.main" sx={{ mb: 2 }}>
              There are no accounts below yours to allocate to yet. Add a dealer or customer account first (Hierarchy),
              or send an invite link.
            </Typography>
          )}
          <Stack spacing={2}>
            <FormControl fullWidth required>
              <InputLabel id="allocate-target-label">Target account</InputLabel>
              <Select labelId="allocate-target-label" label="Target account" value={targetId} onChange={e => setTargetId(e.target.value)}>
                {accounts.map(a => (
                  <MenuItem key={a.id} value={a.id} sx={{ fontFamily: monoFont, fontSize: '0.85rem' }}>
                    {a.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField label="Note (optional)" value={note} onChange={e => setNote(e.target.value)} multiline minRows={2} fullWidth />
          </Stack>

          {result && (
            <Box sx={{ mt: 2 }}>
              <Divider sx={{ mb: 2 }} />
              <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                <Chip size="small" color="success" label={`${result.results.filter(r => r.success).length} allocated`} />
                {result.results.some(r => !r.success) && (
                  <Chip size="small" color="error" label={`${result.results.filter(r => !r.success).length} failed`} />
                )}
              </Box>
              {result.results.some(r => !r.success) && (
                <List dense sx={{ maxHeight: 160, overflowY: 'auto', bgcolor: 'background.surfaceVariant', borderRadius: 1 }}>
                  {result.results
                    .filter(r => !r.success)
                    .map(r => (
                      <ListItem key={r.pump_id}>
                        <ListItemText
                          primary={r.pump_id}
                          secondary={r.reason}
                          slotProps={{ primary: { sx: { fontFamily: monoFont, fontSize: '0.85rem' } } }}
                        />
                      </ListItem>
                    ))}
                </List>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Close</Button>
          <Button type="submit" variant="contained" disabled={busy || !targetId}>
            Allocate
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};
