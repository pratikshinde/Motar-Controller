import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Card, CardContent, Typography, CircularProgress, Alert, TextField, Button, Stack, List, ListItem, ListItemText, Divider } from '@mui/material';
import { LineChart } from '@mui/x-charts/LineChart';
import { fetchPumpProvenance, fetchPumpTelemetry, setPumpPanel, fetchMcuSwapHistory, postMcuSwap } from '../../api/pumps';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { monoFont } from '../../theme';
import type { PumpProvenance, TelemetryRow, PanelBinding, McuSwapHistory } from '../../types';

const CAN_EDIT_INSTALL_FIELDS = new Set(['superadmin', 'manufacturer', 'distributor', 'dealer']);

// §8.4 Diagnostics tab (Web_App_Pending_Items.md §6) calls for firmware/
// hardware versions, signal history, raw messages and OTA history. Only
// the first two have real backing data in this system: firmware version
// is a reported pump field, hardware/MCU/IMEI come from the manufacturing
// batch this device was claimed from (if any). "Raw messages" has no
// store — telemetry is parsed into telemetry_history at ingest, nothing
// keeps the wire bytes — and OTA history is blocked on Stream 4 (no OTA
// mechanism exists yet). Both are called out explicitly below instead of
// being silently omitted or faked.
export const DiagnosticsTab: React.FC<{
  pumpId: string;
  firmwareVersion: string | null;
  panel: PanelBinding;
  onPanelSaved: () => void;
}> = ({ pumpId, firmwareVersion, panel, onPanelSaved }) => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [provenance, setProvenance] = useState<PumpProvenance | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const canEdit = Boolean(user && CAN_EDIT_INSTALL_FIELDS.has(user.role));

  const [panelForm, setPanelForm] = useState<PanelBinding>(panel);
  const [panelSaving, setPanelSaving] = useState(false);

  const [mcuHistory, setMcuHistory] = useState<McuSwapHistory | null>(null);
  const [mcuHistoryLoading, setMcuHistoryLoading] = useState(true);
  const [newMcuUid, setNewMcuUid] = useState('');
  const [mcuReason, setMcuReason] = useState('');
  const [mcuSwapping, setMcuSwapping] = useState(false);

  const loadMcuHistory = useCallback(async () => {
    try {
      setMcuHistory(await fetchMcuSwapHistory(pumpId));
    } catch (err: any) {
      showToast(err.message || 'Could not load MCU swap history', true);
    } finally {
      setMcuHistoryLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pumpId]);

  const load = useCallback(async () => {
    try {
      const [prov, tel] = await Promise.all([fetchPumpProvenance(pumpId), fetchPumpTelemetry(pumpId, 24)]);
      setProvenance(prov);
      setTelemetry(tel.telemetry);
    } catch (err: any) {
      showToast(err.message || 'Could not load diagnostics', true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pumpId]);

  useEffect(() => {
    load();
    loadMcuHistory();
  }, [load, loadMcuHistory]);

  useEffect(() => {
    setPanelForm(panel);
  }, [panel]);

  function setPanelField(key: keyof PanelBinding, value: string) {
    setPanelForm(prev => ({ ...prev, [key]: value || null }));
  }

  async function handleSavePanel() {
    setPanelSaving(true);
    try {
      await setPumpPanel(pumpId, panelForm);
      showToast('Panel binding updated');
      onPanelSaved();
    } catch (err: any) {
      showToast(err.message || 'Could not save panel binding', true);
    } finally {
      setPanelSaving(false);
    }
  }

  async function handleMcuSwap() {
    if (!newMcuUid.trim()) {
      showToast('New MCU UID is required', true);
      return;
    }
    setMcuSwapping(true);
    try {
      await postMcuSwap(pumpId, newMcuUid.trim(), mcuReason.trim() || undefined);
      showToast('MCU swap logged');
      setNewMcuUid('');
      setMcuReason('');
      loadMcuHistory();
    } catch (err: any) {
      showToast(err.message || 'Could not log MCU swap', true);
    } finally {
      setMcuSwapping(false);
    }
  }

  const xAxisData = useMemo(() => telemetry.map(r => new Date(r.recorded_at)), [telemetry]);
  const rssiData = useMemo(() => telemetry.map(r => (r.gsm_rssi == null ? null : r.gsm_rssi)), [telemetry]);

  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: 200 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Card elevation={1}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Firmware &amp; Hardware
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Row label="Firmware version" value={firmwareVersion || 'not yet reported'} />
            <Row label="MCU UID" value={mcuHistory?.current_mcu_uid || provenance?.batch?.mcu_uid || '—'} mono />
            {provenance?.batch ? (
              <>
                <Row label="Hardware revision" value={provenance.batch.hw_rev || '—'} />
                <Row label="Modem IMEI" value={provenance.batch.imei} mono />
                <Row label="Manufacturing batch" value={`${provenance.batch.batch_code} (${provenance.batch.model})`} />
              </>
            ) : (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                Not claimed from a tracked manufacturing batch — no hardware revision or IMEI on record.
              </Typography>
            )}
          </Box>
        </CardContent>
      </Card>

      <Card elevation={1}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Panel Binding (FR-WEB-031)
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            Install-time record of the physical control panel this device is fitted into — not reported by the
            device itself.
          </Typography>
          {canEdit ? (
            <Stack spacing={1.5}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
                <TextField
                  size="small"
                  label="Panel serial"
                  value={panelForm.panel_serial || ''}
                  onChange={e => setPanelField('panel_serial', e.target.value)}
                />
                <TextField
                  size="small"
                  label="Motor rating"
                  value={panelForm.motor_rating || ''}
                  onChange={e => setPanelField('motor_rating', e.target.value)}
                />
                <TextField
                  size="small"
                  label="Starter type"
                  value={panelForm.starter_type || ''}
                  onChange={e => setPanelField('starter_type', e.target.value)}
                />
                <TextField
                  size="small"
                  label="Pump make"
                  value={panelForm.pump_make || ''}
                  onChange={e => setPanelField('pump_make', e.target.value)}
                />
                <TextField
                  size="small"
                  label="Pump model"
                  value={panelForm.pump_model || ''}
                  onChange={e => setPanelField('pump_model', e.target.value)}
                />
              </Box>
              <Button variant="tonal" size="small" onClick={handleSavePanel} disabled={panelSaving} sx={{ alignSelf: 'flex-start' }}>
                Save panel binding
              </Button>
            </Stack>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              <Row label="Panel serial" value={panel.panel_serial || '—'} mono />
              <Row label="Motor rating" value={panel.motor_rating || '—'} />
              <Row label="Starter type" value={panel.starter_type || '—'} />
              <Row label="Pump make" value={panel.pump_make || '—'} />
              <Row label="Pump model" value={panel.pump_model || '—'} />
            </Box>
          )}
        </CardContent>
      </Card>

      <Card elevation={1}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Controller (MCU) Swap History (FR-WEB-034)
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            Routine fitted-component replacement — logs the swap only, the device's identity (IMEI) and all history
            stay unchanged.
          </Typography>
          {mcuHistoryLoading ? (
            <CircularProgress size={20} />
          ) : (
            <>
              {mcuHistory && mcuHistory.history.length > 0 ? (
                <List dense sx={{ mb: canEdit ? 1.5 : 0 }}>
                  {mcuHistory.history.map((entry, i) => (
                    <React.Fragment key={entry.id}>
                      {i > 0 && <Divider component="li" />}
                      <ListItem sx={{ px: 0 }}>
                        <ListItemText
                          primary={`${entry.old_mcu_uid || '(none)'} → ${entry.new_mcu_uid}`}
                          secondary={
                            `${new Date(entry.occurred_at).toLocaleString()} · by ${entry.performed_by_name || 'system'}` +
                            (entry.reason ? ` · ${entry.reason}` : '')
                          }
                          slotProps={{ primary: { sx: { fontFamily: monoFont, fontSize: '0.85rem' } } }}
                        />
                      </ListItem>
                    </React.Fragment>
                  ))}
                </List>
              ) : (
                <Typography color="text.secondary" sx={{ mb: canEdit ? 1.5 : 0 }}>
                  No MCU swaps on record for this device.
                </Typography>
              )}
              {canEdit && (
                <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <TextField
                    size="small"
                    label="New MCU UID"
                    value={newMcuUid}
                    onChange={e => setNewMcuUid(e.target.value)}
                    slotProps={{ htmlInput: { style: { fontFamily: monoFont } } }}
                  />
                  <TextField size="small" label="Reason (optional)" value={mcuReason} onChange={e => setMcuReason(e.target.value)} sx={{ minWidth: 200 }} />
                  <Button variant="tonal" size="small" onClick={handleMcuSwap} disabled={mcuSwapping} sx={{ mt: 0.25 }}>
                    Log swap
                  </Button>
                </Stack>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card elevation={1}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Signal Strength (last 24h)
          </Typography>
          {telemetry.length === 0 ? (
            <Typography color="text.secondary">No telemetry recorded in this window.</Typography>
          ) : (
            <LineChart
              height={220}
              xAxis={[{ data: xAxisData, scaleType: 'time' }]}
              series={[{ data: rssiData, label: 'GSM RSSI (dBm)', showMark: false }]}
            />
          )}
        </CardContent>
      </Card>

      <Card elevation={1}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Not Yet Available
          </Typography>
          <Alert severity="info" variant="outlined" sx={{ mb: 1 }}>
            Raw device messages — this backend parses telemetry into structured rows at ingest and doesn't retain the
            original wire payload.
          </Alert>
          <Alert severity="info" variant="outlined">
            OTA update history — firmware release management is blocked on the Stream 4 OTA mechanism, which doesn't
            exist yet.
          </Alert>
        </CardContent>
      </Card>
    </Box>
  );
};

const Row: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
    <Typography variant="body2" color="text.secondary">
      {label}
    </Typography>
    <Typography variant="body2" sx={{ fontFamily: mono ? monoFont : undefined, fontWeight: 700 }}>
      {value}
    </Typography>
  </Box>
);
