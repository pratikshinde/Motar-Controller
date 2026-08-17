import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Card, CardContent, Typography, Chip, CircularProgress, List, ListItem,
  ListItemText, Button, TextField, Stack, Divider, Alert
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { fetchPumpProvenance, setPumpWarranty, postBridgeSwap } from '../../api/pumps';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { monoFont } from '../../theme';
import { ROLE_NAMES } from '../../api/users';
import type { PumpProvenance } from '../../types';

// §8.4 Ownership tab (Web_App_Pending_Items.md §6): current owner,
// allocation history from `allocation_log`, warranty. There is no separate
// "site" entity in this data model — location is already GPS coordinates
// on the pump itself (shown on Overview/Map), so this doesn't invent one.
export const OwnershipTab: React.FC<{ pumpId: string }> = ({ pumpId }) => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<PumpProvenance | null>(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [periodMonths, setPeriodMonths] = useState('');
  const [saving, setSaving] = useState(false);

  const [newImei, setNewImei] = useState('');
  const [swapReason, setSwapReason] = useState('');
  const [swapping, setSwapping] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await fetchPumpProvenance(pumpId);
      setData(d);
      setStartDate(d.warranty?.start_date ? d.warranty.start_date.slice(0, 10) : '');
      setPeriodMonths(d.warranty?.period_months ? String(d.warranty.period_months) : '');
    } catch (err: any) {
      showToast(err.message || 'Could not load ownership data', true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pumpId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSaveWarranty() {
    setSaving(true);
    try {
      await setPumpWarranty(pumpId, startDate || null, periodMonths ? Number(periodMonths) : null);
      showToast('Warranty updated');
      load();
    } catch (err: any) {
      showToast(err.message || 'Could not save warranty', true);
    } finally {
      setSaving(false);
    }
  }

  async function handleBridgeSwap() {
    if (!/^\d{15}$/.test(newImei.trim())) {
      showToast('New IMEI must be exactly 15 digits', true);
      return;
    }
    if (
      !window.confirm(
        `Superadmin action: migrate this device's identity from ${pumpId} to ${newImei.trim()}?\n\n` +
          `All telemetry, faults, configuration, commands and allocation history carry over to the new IMEI. ` +
          `The old device ID (${pumpId}) will stop existing and a fresh device key will be issued. This cannot be undone.`
      )
    ) {
      return;
    }
    setSwapping(true);
    try {
      const res = await postBridgeSwap(pumpId, newImei.trim(), swapReason.trim() || undefined);
      showToast(`Device migrated to ${res.new_pump_id} — new device key: ${res.device_key}`);
      navigate(`/devices/${encodeURIComponent(res.new_pump_id)}`);
    } catch (err: any) {
      showToast(err.message || 'Bridge swap failed', true);
    } finally {
      setSwapping(false);
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: 200 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!data) return null;

  const isSuperadmin = user?.role === 'superadmin';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Card elevation={1}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Current Owner
          </Typography>
          {data.owner ? (
            <Box>
              <Typography variant="body1" sx={{ fontWeight: 700 }}>
                {data.owner.full_name}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {ROLE_NAMES[data.owner.role]}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }}>
                {data.owner.phone_number}
              </Typography>
            </Box>
          ) : (
            <Typography color="text.secondary">No owner on record.</Typography>
          )}
        </CardContent>
      </Card>

      <Card elevation={1}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Warranty
          </Typography>
          {data.warranty ? (
            <Box sx={{ mb: isSuperadmin ? 2 : 0 }}>
              <Typography variant="body2">
                {data.warranty.start_date.slice(0, 10)} → {data.warranty.end_date} ({data.warranty.period_months} months)
              </Typography>
              <Chip
                size="small"
                sx={{ mt: 1 }}
                label={data.warranty.expired ? 'Expired' : 'Active'}
                color={data.warranty.expired ? 'error' : 'success'}
                variant="outlined"
              />
            </Box>
          ) : (
            <Typography color="text.secondary" sx={{ mb: isSuperadmin ? 2 : 0 }}>
              No warranty on record.
            </Typography>
          )}
          {isSuperadmin && (
            <Stack direction="row" spacing={2} useFlexGap sx={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <TextField
                label="Warranty start date"
                type="date"
                size="small"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                label="Period (months)"
                type="number"
                size="small"
                value={periodMonths}
                onChange={e => setPeriodMonths(e.target.value)}
                sx={{ width: 160 }}
              />
              <Button variant="contained" size="small" onClick={handleSaveWarranty} disabled={saving} sx={{ mt: 0.25 }}>
                Save
              </Button>
            </Stack>
          )}
        </CardContent>
      </Card>

      <Card elevation={1}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Allocation History
          </Typography>
          {data.allocation_history.length === 0 ? (
            <Typography color="text.secondary">No ownership transfers on record for this device.</Typography>
          ) : (
            <List dense>
              {data.allocation_history.map((entry, i) => (
                <React.Fragment key={entry.id}>
                  {i > 0 && <Divider component="li" />}
                  <ListItem>
                    <ListItemText
                      primary={`${entry.from_full_name || '(unassigned)'} → ${entry.to_full_name}`}
                      secondary={
                        `${new Date(entry.occurred_at).toLocaleString()} · by ${entry.actor_full_name || 'system'}` +
                        (entry.note ? ` · ${entry.note}` : '')
                      }
                    />
                  </ListItem>
                </React.Fragment>
              ))}
            </List>
          )}
        </CardContent>
      </Card>

      {isSuperadmin && (
        <Card elevation={1} sx={{ borderColor: 'error.main', borderWidth: 1, borderStyle: 'solid' }}>
          <CardContent>
            <Typography variant="h6" gutterBottom color="error">
              Bridge (Modem) Swap — RMA / Warranty Replacement (FR-WEB-034)
            </Typography>
            <Alert severity="warning" variant="outlined" sx={{ mb: 2 }}>
              Use only when the whole IMEI-identified device is being physically replaced (RMA, warranty swap). This
              migrates the device's identity to the new IMEI and carries over all telemetry, faults, configuration,
              commands and allocation history — the old device ID stops existing and a fresh device key is issued.
              This is irreversible.
            </Alert>
            <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <TextField
                size="small"
                label="New IMEI"
                value={newImei}
                onChange={e => setNewImei(e.target.value)}
                slotProps={{ htmlInput: { maxLength: 15, style: { fontFamily: monoFont } } }}
                sx={{ width: 200 }}
              />
              <TextField size="small" label="Reason (optional)" value={swapReason} onChange={e => setSwapReason(e.target.value)} sx={{ minWidth: 220 }} />
              <Button variant="contained" color="error" size="small" onClick={handleBridgeSwap} disabled={swapping} sx={{ mt: 0.25 }}>
                Migrate device identity
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}
    </Box>
  );
};
