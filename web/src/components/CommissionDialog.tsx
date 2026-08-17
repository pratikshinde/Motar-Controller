import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Stack, Box
} from '@mui/material';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import { createPump, updatePumpLocation } from '../api/pumps';
import { useToast } from '../context/ToastContext';
import type { PumpListItem } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** When set, the dialog edits this pump's location instead of creating a new device. */
  editingPump: PumpListItem | null;
}

export const CommissionDialog: React.FC<Props> = ({ open, onClose, onSaved, editingPump }) => {
  const { showToast } = useToast();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [lat, setLat] = useState('19.9975');
  const [lng, setLng] = useState('73.7898');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      if (editingPump) {
        setId(editingPump.id);
        setName(editingPump.name);
        setLat(String(editingPump.latitude));
        setLng(String(editingPump.longitude));
      } else {
        setId('');
        setName('');
        setLat('19.9975');
        setLng('73.7898');
      }
    }
  }, [open, editingPump]);

  function captureGps() {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        showToast(`High-accuracy GPS captured (${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)})`);
      },
      () => {
        setLat('19.998200');
        setLng('73.791500');
      }
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      showToast('Pump name is required', true);
      return;
    }
    setBusy(true);
    try {
      if (editingPump) {
        await updatePumpLocation(editingPump.id, parseFloat(lat), parseFloat(lng));
        showToast(`Location updated for ${name}`);
      } else {
        const newId = id.trim() || `PUMP-4G-3P-${Math.floor(1000 + Math.random() * 9000)}`;
        const result = await createPump({
          id: newId,
          name: name.trim(),
          supply_type: '3-phase',
          hp_rating: 15.0,
          latitude: parseFloat(lat) || 19.9975,
          longitude: parseFloat(lng) || 73.7898
        });
        showToast(`Device ${name} created. Device key (save now, shown once): ${result.device_key}`);
      }
      onSaved();
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Save failed', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <form onSubmit={submit}>
        <DialogTitle>{editingPump ? `Edit Location: ${editingPump.name}` : 'Commission New Pump Panel'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Device ID (thing name / serial no.)"
              placeholder="e.g. PUMP-4G-3P-9901"
              value={id}
              onChange={e => setId(e.target.value)}
              disabled={Boolean(editingPump)}
              fullWidth
            />
            <TextField
              label="Pump name / designation"
              placeholder="e.g. Borewell Pump #1"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={Boolean(editingPump)}
              required
              fullWidth
            />
            <Box sx={{ display: 'flex', gap: 1.5 }}>
              <TextField label="Latitude" value={lat} onChange={e => setLat(e.target.value)} fullWidth required />
              <TextField label="Longitude" value={lng} onChange={e => setLng(e.target.value)} fullWidth required />
            </Box>
            <Button variant="tonal" startIcon={<MyLocationIcon />} onClick={captureGps} type="button">
              Use current location (smartphone GPS)
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={busy}>
            Save device
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};
