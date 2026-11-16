import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  fetchRemovalPreview,
  reactivateUserAccount,
  removeUserAccount,
  suspendUserAccount,
  type RemovalPreview,
} from '../api/users';
import { useToast } from '../context/ToastContext';

const QUICK_REASONS = ['Registered by mistake', 'Left the company', 'No longer active', 'Duplicate account'];

export interface RemovePersonTarget {
  id: string;
  name: string;
  label?: string;
}

interface Props {
  target: RemovePersonTarget | null;
  onClose: () => void;
  onRemoved: () => void;
  onStatusChanged?: () => void;
}

export const RemovePersonDialog: React.FC<Props> = ({ target, onClose, onRemoved, onStatusChanged }) => {
  let showToast: (msg: string, isError?: boolean) => void = () => {};
  try {
    showToast = useToast().showToast;
  } catch {
    // Fallback for unit tests rendered outside ToastProvider
  }
  const [preview, setPreview] = useState<RemovalPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Nothing is filled in beforehand: the reason and the person's name must be typed (or picked) on purpose, so one mistaken click removes nobody.
  const [reason, setReason] = useState('');
  const [confirmName, setConfirmName] = useState('');

  useEffect(() => {
    if (!target) {
      setPreview(null);
      setError('');
      setReason('');
      setConfirmName('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchRemovalPreview(target.id)
      .then(res => {
        if (!cancelled) {
          setPreview(res);
          setConfirmName('');
        }
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || 'Could not check this account');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target]);

  const roleLabel = target?.label || (preview?.role === 'manufacturer' ? 'admin' : preview?.role || 'account');
  const expectedName = (preview?.full_name || target?.name || '').trim();
  const nameMatches = confirmName.trim().toLowerCase() === expectedName.toLowerCase();
  const reasonOk = reason.trim().length >= 5;

  async function handleRemove() {
    if (!target || !preview) return;
    if (!reasonOk) {
      setError('Please give a reason (at least 5 characters).');
      return;
    }
    if (!nameMatches) {
      setError(`Type "${expectedName}" to confirm permanent removal.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await removeUserAccount(target.id, reason.trim(), confirmName.trim());
      showToast(`${expectedName} removed`);
      onRemoved();
    } catch (err: any) {
      setError(err?.message || 'Could not remove this account');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleSuspend() {
    if (!target || !preview) return;
    if (!reasonOk) {
      setError('Please give a reason (at least 5 characters).');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (preview.status === 'SUSPENDED') {
        await reactivateUserAccount(target.id, reason.trim());
        showToast(`${expectedName} switched back on`);
      } else {
        await suspendUserAccount(target.id, reason.trim());
        showToast(`${expectedName} switched off`);
      }
      if (onStatusChanged) onStatusChanged();
      else onRemoved();
    } catch (err: any) {
      setError(err?.message || 'Could not change account status');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(target)} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth data-testid="remove-person-dialog">
      <DialogTitle sx={{ fontWeight: 800 }}>
        Remove {roleLabel}: {target?.name}
      </DialogTitle>
      <DialogContent dividers>
        {loading && (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 5 }}>
            <CircularProgress size={32} />
          </Box>
        )}

        {!loading && error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {!loading && preview && (
          <Stack spacing={2.25}>
            <Box>
              <Typography sx={{ fontWeight: 700 }}>{preview.full_name}</Typography>
              <Typography variant="body2" color="text.secondary">
                {preview.email} · Status: {preview.status === 'SUSPENDED' ? 'Switched off' : 'Active'}
              </Typography>
            </Box>

            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              <Chip size="small" label={`${preview.beneath.distributors} Distributors`} variant="outlined" />
              <Chip size="small" label={`${preview.beneath.dealers} Dealers`} variant="outlined" />
              <Chip size="small" label={`${preview.beneath.farmers} Farmers`} variant="outlined" />
              <Chip size="small" label={`${preview.beneath.pumps} Pumps`} variant="outlined" />
            </Stack>

            {preview.can_delete ? (
              <Alert severity="warning">
                No people or pumps are registered under <b>{preview.full_name}</b>. Removing this {roleLabel} will permanently delete their login and company card.
              </Alert>
            ) : (
              <Alert severity="info">
                {preview.blocked_reason || 'This account has people or pumps under it, so it cannot be deleted permanently. Switch it off instead to block sign-in while keeping all records.'}
              </Alert>
            )}

            <Box>
              <TextField
                label="Reason"
                value={reason}
                onChange={e => setReason(e.target.value)}
                fullWidth
                size="small"
                placeholder="Why is this account being removed or switched off?"
                slotProps={{ htmlInput: { 'data-testid': 'remove-reason-input' } }}
              />
              <Stack direction="row" spacing={0.75} sx={{ mt: 1, flexWrap: 'wrap', rowGap: 0.75 }}>
                {QUICK_REASONS.map(r => (
                  <Chip
                    key={r}
                    size="small"
                    label={r}
                    onClick={() => setReason(r)}
                    color={reason === r ? 'primary' : 'default'}
                    variant={reason === r ? 'filled' : 'outlined'}
                  />
                ))}
              </Stack>
            </Box>

            {preview.can_delete && (
              <TextField
                label="Type their name to confirm"
                value={confirmName}
                onChange={e => setConfirmName(e.target.value)}
                fullWidth
                size="small"
                helperText={`Type exactly: ${preview.full_name}`}
                slotProps={{ htmlInput: { 'data-testid': 'remove-confirm-name-input' } }}
              />
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={onClose} disabled={busy} color="inherit">
          Cancel
        </Button>
        <Stack direction="row" spacing={1}>
          {preview && (
            <Button
              variant="outlined"
              color={preview.status === 'SUSPENDED' ? 'success' : 'warning'}
              disabled={busy || !reasonOk}
              onClick={handleToggleSuspend}
              data-testid="confirm-toggle-status"
            >
              {preview.status === 'SUSPENDED' ? 'Switch back on' : 'Switch off login'}
            </Button>
          )}
          {preview?.can_delete && (
            <Button
              variant="contained"
              color="error"
              disabled={busy || !reasonOk || !nameMatches}
              onClick={handleRemove}
              data-testid="confirm-remove"
            >
              Remove permanently
            </Button>
          )}
        </Stack>
      </DialogActions>
    </Dialog>
  );
};
