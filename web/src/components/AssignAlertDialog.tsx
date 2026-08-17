import React, { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { fetchUserTree, ROLE_NAMES } from '../api/users';
import { assignAlert } from '../api/alerts';
import { useToast } from '../context/ToastContext';
import { monoFont } from '../theme';
import type { UserTreeNode } from '../types';

interface FlatAccount {
  id: string;
  label: string;
}

function flattenTree(nodes: UserTreeNode[]): FlatAccount[] {
  const out: FlatAccount[] = [];
  function walk(list: UserTreeNode[]) {
    for (const node of list) {
      for (const member of node.members) {
        out.push({ id: member.id, label: `${member.full_name} — ${ROLE_NAMES[member.role]} — ${member.phone_number}` });
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
  onAssigned: () => void;
  alertId: string | null;
}

export const AssignAlertDialog: React.FC<Props> = ({ open, onClose, onAssigned, alertId }) => {
  const { showToast } = useToast();
  const [accounts, setAccounts] = useState<FlatAccount[]>([]);
  const [assigneeId, setAssigneeId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setAssigneeId('');
      fetchUserTree()
        .then(data => setAccounts(flattenTree(data.tree)))
        .catch(err => showToast(err.message || 'Could not load accounts', true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!alertId || !assigneeId) return;
    setBusy(true);
    try {
      await assignAlert(alertId, assigneeId);
      showToast('Alert assigned');
      onAssigned();
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Could not assign alert', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <form onSubmit={submit}>
        <DialogTitle>Assign Alert</DialogTitle>
        <DialogContent>
          <FormControl fullWidth required sx={{ mt: 1 }}>
            <InputLabel id="assign-alert-label">Assignee</InputLabel>
            <Select labelId="assign-alert-label" label="Assignee" value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
              {accounts.map(a => (
                <MenuItem key={a.id} value={a.id} sx={{ fontFamily: monoFont, fontSize: '0.85rem' }}>
                  {a.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={busy || !assigneeId}>
            Assign
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};
