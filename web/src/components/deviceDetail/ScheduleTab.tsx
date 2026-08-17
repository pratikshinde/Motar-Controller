import React, { useState } from 'react';
import { Box, Card, CardContent, Typography, Switch, TextField, Button, Stack, LinearProgress, Alert } from '@mui/material';
import { setDesiredConfig } from '../../api/config';
import { useToast } from '../../context/ToastContext';
import type { DeviceConfig } from '../../types';

// §8.4 Schedule tab (Web_App_Pending_Items.md §6): "cyclic ON/OFF/cycle-
// limit editor with duty-cycle preview — must not imply clock-time
// scheduling, the device has no RTC." This is a curated view over the
// SAME three layer-A keys already editable in the Configuration tab (cyc,
// on_t, rst_t — see web/src/config/layerA.ts) — not a new mechanism. It
// PUT-updates the full desired_json, not just these three keys, because
// the backend replaces desired_json wholesale rather than merging
// (server.js's device_config upsert uses EXCLUDED.desired_json) — sending
// only the schedule keys would silently erase Protection/Motor settings
// set from the Configuration tab.
export const ScheduleTab: React.FC<{ pumpId: string; initialConfig: DeviceConfig | null; onSaved: () => void }> = ({
  pumpId,
  initialConfig,
  onSaved
}) => {
  const { showToast } = useToast();
  const desiredSrc = initialConfig?.desired_json ?? {};
  const [cyclic, setCyclic] = useState(String(desiredSrc.cyc ?? '0') === '1');
  const [onMinutes, setOnMinutes] = useState(desiredSrc.on_t !== undefined ? String(desiredSrc.on_t) : '');
  const [restMinutes, setRestMinutes] = useState(desiredSrc.rst_t !== undefined ? String(desiredSrc.rst_t) : '');
  const [saving, setSaving] = useState(false);

  const reportedCyc = initialConfig?.reported_json?.cyc;
  const reportedOn = initialConfig?.reported_json?.on_t;
  const reportedRst = initialConfig?.reported_json?.rst_t;
  const isApplied =
    reportedCyc !== undefined && String(reportedCyc) === (cyclic ? '1' : '0') && String(reportedOn) === onMinutes && String(reportedRst) === restMinutes;

  const onNum = Number(onMinutes) || 0;
  const restNum = Number(restMinutes) || 0;
  const totalCycle = onNum + restNum;
  const dutyPercent = totalCycle > 0 ? Math.round((onNum / totalCycle) * 100) : 0;

  async function handleSave() {
    setSaving(true);
    try {
      const payload: Record<string, number | boolean> = { ...desiredSrc };
      payload.cyc = cyclic ? 1 : 0;
      if (onMinutes !== '') payload.on_t = Number(onMinutes);
      if (restMinutes !== '') payload.rst_t = Number(restMinutes);
      await setDesiredConfig(pumpId, payload);
      showToast('Schedule set (pending device acknowledgement)');
      onSaved();
    } catch (err: any) {
      showToast(err.message || 'Could not save schedule', true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Alert severity="info" variant="outlined">
        Cyclic ON/OFF timing only — the device has no real-time clock, so this cannot run at specific times of day, only
        as a repeating ON/rest cycle while active.
      </Alert>

      <Card elevation={1}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Typography variant="h6">Cyclic timer</Typography>
            <Switch checked={cyclic} onChange={e => setCyclic(e.target.checked)} />
          </Box>

          <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
            <TextField
              label="Motor ON time"
              type="number"
              size="small"
              value={onMinutes}
              onChange={e => setOnMinutes(e.target.value)}
              slotProps={{ htmlInput: { min: 1, max: 250 } }}
              helperText="minutes, 1–250"
              disabled={!cyclic}
              fullWidth
            />
            <TextField
              label="Rest time before restart"
              type="number"
              size="small"
              value={restMinutes}
              onChange={e => setRestMinutes(e.target.value)}
              slotProps={{ htmlInput: { min: 0, max: 250 } }}
              helperText="minutes, 0–250"
              disabled={!cyclic}
              fullWidth
            />
          </Stack>

          {cyclic && totalCycle > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Duty cycle: {onNum}min ON / {restNum}min rest — {dutyPercent}% ON over a {totalCycle}min cycle
              </Typography>
              <LinearProgress variant="determinate" value={dutyPercent} sx={{ height: 10, borderRadius: 5, mt: 0.5 }} />
            </Box>
          )}

          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="caption" color="text.secondary">
              {reportedCyc !== undefined
                ? `Reported: ${String(reportedCyc) === '1' ? 'cyclic' : 'off'}, ON ${reportedOn ?? '—'}min / rest ${reportedRst ?? '—'}min ${isApplied ? '(applied)' : '(pending)'}`
                : 'Never reported by device'}
            </Typography>
            <Button variant="contained" size="small" onClick={handleSave} disabled={saving}>
              Save schedule
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
};
