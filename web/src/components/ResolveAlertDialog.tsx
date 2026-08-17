import React, { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField } from '@mui/material';
import { resolveAlert } from '../api/alerts';
import { useToast } from '../context/ToastContext';

interface Props {
  open: boolean;
  onClose: () => void;
  onResolved: () => void;
  alertId: string | null;
}

export const ResolveAlertDialog: React.FC<Props> = ({ open, onClose, onResolved, alertId }) => {
  const { showToast } = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setNote('');
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!alertId) return;
    setBusy(true);
    try {
      await resolveAlert(alertId, note.trim() || undefined);
      showToast('Alert resolved');
      onResolved();
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Could not resolve alert', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <form onSubmit={submit}>
        <DialogTitle>Resolve Alert</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label="Resolution note (optional)"
            value={note}
            onChange={e => setNote(e.target.value)}
            multiline
            minRows={3}
            fullWidth
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={busy}>
            Resolve
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};
