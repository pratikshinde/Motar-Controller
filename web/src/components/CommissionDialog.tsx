import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Stack, Box, MenuItem
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
  const [deviceType, setDeviceType] = useState<'AC_3PH' | 'SOLAR_VFD'>('AC_3PH');
  // Blank means "position unknown" - never a stand-in coordinate that would put a pump in some other place on the map.
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      if (editingPump) {
        setId(editingPump.id);
        setName(editingPump.name);
        setDeviceType(editingPump.device_type || 'AC_3PH');
        setLat(editingPump.latitude === null || editingPump.latitude === '' ? '' : String(editingPump.latitude));
        setLng(editingPump.longitude === null || editingPump.longitude === '' ? '' : String(editingPump.longitude));
      } else {
        setId('');
        setName('');
        setDeviceType('AC_3PH');
        setLat('');
        setLng('');
      }
    }
  }, [open, editingPump]);

  function captureGps() {
    if (!('geolocation' in navigator)) {
      showToast('This browser cannot read your location. Type the latitude and longitude instead.', true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        showToast(`High-accuracy GPS captured (${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)})`);
      },
      () => {
        // Say so and leave the fields alone: a made-up position would be saved as if it were the pump's real one.
        showToast('Could not read your location (permission denied or no signal). Type the latitude and longitude instead.', true);
      }
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      showToast('Pump name is required', true);
      return;
    }
    const latitude = lat.trim() === '' ? undefined : Number(lat);
    const longitude = lng.trim() === '' ? undefined : Number(lng);
    const bad = (v: number | undefined, limit: number) => v !== undefined && (!Number.isFinite(v) || Math.abs(v) > limit);
    if (bad(latitude, 90) || bad(longitude, 180) || (latitude === undefined) !== (longitude === undefined)) {
      showToast('Enter both a latitude (-90 to 90) and a longitude (-180 to 180), or leave both blank if the position is not known yet', true);
      return;
    }
    setBusy(true);
    try {
      if (editingPump) {
        if (latitude === undefined || longitude === undefined) {
          showToast('Enter the latitude and longitude to update the location', true);
          setBusy(false);
          return;
        }
        await updatePumpLocation(editingPump.id, latitude, longitude);
        showToast(`Location updated for ${name}`);
      } else {
        const newId = id.trim() || `PUMP-4G-3P-${Math.floor(1000 + Math.random() * 9000)}`;
        const result = await createPump({
          id: newId,
          name: name.trim(),
          device_type: deviceType,
          supply_type: '3-phase',
          hp_rating: deviceType === 'SOLAR_VFD' ? 7.5 : 15.0,
          // Left blank stays unknown: no invented position.
          latitude,
          longitude
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
              select
              label="Device Type"
              value={deviceType}
              onChange={e => setDeviceType(e.target.value as 'AC_3PH' | 'SOLAR_VFD')}
              disabled={Boolean(editingPump)}
              fullWidth
            >
              <MenuItem value="AC_3PH">AC 3-Phase Pump</MenuItem>
              <MenuItem value="SOLAR_VFD">Solar VFD Pump (Fuji FRENIC-Ace)</MenuItem>
            </TextField>
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
              <TextField label="Latitude" value={lat} onChange={e => setLat(e.target.value)} placeholder="e.g. 19.9975" fullWidth />
              <TextField label="Longitude" value={lng} onChange={e => setLng(e.target.value)} placeholder="e.g. 73.7898" fullWidth />
            </Box>
            <Button variant="tonal" startIcon={<MyLocationIcon />} onClick={captureGps} type="button">
              Use current location (smartphone GPS)
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? 'Saving…' : editingPump ? 'Update Location' : 'Register Device'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};
