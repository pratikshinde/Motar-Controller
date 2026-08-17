import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, FormControl, InputLabel,
  Select, MenuItem, Checkbox, FormControlLabel, Stack, List, ListItem, ListItemText,
  IconButton, Typography, Divider, CircularProgress
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/DeleteOutlineOutlined';
import { usePumps } from '../hooks/usePumps';
import { fetchAlertSubscriptions, createAlertSubscription, deleteAlertSubscription } from '../api/alerts';
import { useToast } from '../context/ToastContext';
import { monoFont } from '../theme';
import type { AlertSubscription } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
}

// FR-WEB-060 — a user's own subscription rows. No rows at all means
// subscribed to everything in scope by default (see the schema.sql §16
// comment on the backend); rows here only narrow or mute, they never
// need to be created just to "turn alerts on."
export const AlertSubscriptionsDialog: React.FC<Props> = ({ open, onClose }) => {
  const { showToast } = useToast();
  const { pumps } = usePumps();
  const [subs, setSubs] = useState<AlertSubscription[]>([]);
  const [loading, setLoading] = useState(true);

  const [pumpId, setPumpId] = useState('');
  const [alertType, setAlertType] = useState('');
  const [minSeverity, setMinSeverity] = useState('');
  const [muted, setMuted] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchAlertSubscriptions();
      setSubs(data.subscriptions);
    } catch (err: any) {
      showToast(err.message || 'Could not load subscriptions', true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (open) {
      setLoading(true);
      load();
      setPumpId('');
      setAlertType('');
      setMinSeverity('');
      setMuted(false);
    }
  }, [open, load]);

  function pumpName(id: string | null) {
    if (!id) return 'All my devices';
    return pumps.find(p => p.id === id)?.name || id;
  }

  async function handleAdd() {
    setSaving(true);
    try {
      await createAlertSubscription({
        pump_id: pumpId || undefined,
        alert_type: alertType || undefined,
        min_severity: minSeverity || undefined,
        muted
      });
      showToast('Subscription saved');
      setPumpId('');
      setAlertType('');
      setMinSeverity('');
      setMuted(false);
      load();
    } catch (err: any) {
      showToast(err.message || 'Could not save subscription', true);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteAlertSubscription(id);
      showToast('Subscription removed');
      load();
    } catch (err: any) {
      showToast(err.message || 'Could not remove subscription', true);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Alert Subscriptions</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          With no rows below, you're subscribed to every alert in your scope. Add a row to narrow to a specific
          device/type/severity, or to mute one.
        </Typography>

        {loading ? (
          <CircularProgress size={20} />
        ) : subs.length === 0 ? (
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            No custom subscriptions — receiving everything in scope.
          </Typography>
        ) : (
          <List dense sx={{ mb: 2, bgcolor: 'background.surfaceVariant', borderRadius: 1 }}>
            {subs.map((s, i) => (
              <React.Fragment key={s.id}>
                {i > 0 && <Divider component="li" />}
                <ListItem
                  secondaryAction={
                    <IconButton size="small" color="error" onClick={() => handleDelete(s.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  }
                >
                  <ListItemText
                    primary={`${pumpName(s.pump_id)} · ${s.alert_type || 'All types'}${s.min_severity ? ` · ${s.min_severity}+` : ''}`}
                    secondary={s.muted ? 'Muted' : 'Notify'}
                    slotProps={{ primary: { sx: { fontFamily: monoFont, fontSize: '0.85rem' } } }}
                  />
                </ListItem>
              </React.Fragment>
            ))}
          </List>
        )}

        <Divider sx={{ mb: 2 }} />
        <Typography variant="subtitle2" gutterBottom>
          Add subscription
        </Typography>
        <Stack spacing={2}>
          <FormControl size="small" fullWidth>
            <InputLabel id="sub-pump-label">Device</InputLabel>
            <Select labelId="sub-pump-label" label="Device" value={pumpId} onChange={e => setPumpId(e.target.value)}>
              <MenuItem value="">All my devices</MenuItem>
              {pumps.map(p => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth>
            <InputLabel id="sub-type-label">Alert type</InputLabel>
            <Select labelId="sub-type-label" label="Alert type" value={alertType} onChange={e => setAlertType(e.target.value)}>
              <MenuItem value="">All types</MenuItem>
              <MenuItem value="FAULT">Fault</MenuItem>
              <MenuItem value="OFFLINE">Offline</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth>
            <InputLabel id="sub-severity-label">Minimum severity</InputLabel>
            <Select labelId="sub-severity-label" label="Minimum severity" value={minSeverity} onChange={e => setMinSeverity(e.target.value)}>
              <MenuItem value="">All severities</MenuItem>
              <MenuItem value="CRITICAL">Critical only</MenuItem>
              <MenuItem value="HIGH">High and above</MenuItem>
              <MenuItem value="MEDIUM">Medium and above</MenuItem>
              <MenuItem value="LOW">Low and above</MenuItem>
            </Select>
          </FormControl>
          <FormControlLabel control={<Checkbox checked={muted} onChange={e => setMuted(e.target.checked)} />} label="Mute (never notify for this match)" />
          <Button variant="tonal" onClick={handleAdd} disabled={saving} sx={{ alignSelf: 'flex-start' }}>
            Add subscription
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};
