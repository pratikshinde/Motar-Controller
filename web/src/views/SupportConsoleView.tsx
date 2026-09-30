import { outcomeOf, watchCommand } from '../api/commands';
import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Card, CardContent, Autocomplete, TextField, Chip,
  CircularProgress, Switch, Button, Alert, Stack
} from '@mui/material';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@mui/material/styles';
import { usePumps } from '../hooks/usePumps';
import { fetchPumpDetail, fetchPumpTelemetry, dispatchCommand } from '../api/pumps';
import { fetchFaults } from '../api/faults';
import { useCooldowns } from '../hooks/useCooldowns';
import { useToast } from '../context/ToastContext';
import { monoFont } from '../theme';
import type { PumpListItem, PumpDetail, TelemetryRow, FaultLogEntry } from '../types';

const SEVERITY_COLOR: Record<string, 'error' | 'warning' | 'info'> = {
  CRITICAL: 'error',
  HIGH: 'warning',
  MEDIUM: 'warning',
  LOW: 'info'
};

// FR-WEB-018 — support console. Per Web_App_Pending_Items.md §5 this calls
// for a "raw last-N messages" feed, but this backend has no raw-message
// store (telemetry is parsed into telemetry_history at ingest, nothing
// keeps the wire bytes) — building that display would mean fabricating a
// feed with no real backing data. What's built instead is honest: real
// connection history from telemetry_history (every row here is one
// successful device check-in), real fault history, and real diagnostic
// command dispatch — all through the exact same endpoints the rest of the
// app uses, not a parallel "support-only" surface.
export const SupportConsoleView: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { pumps, loading: pumpsLoading } = usePumps();
  const { remaining, start } = useCooldowns();

  const [selected, setSelected] = useState<PumpListItem | null>(null);
  const [detail, setDetail] = useState<PumpDetail | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryRow[]>([]);
  const [faults, setFaults] = useState<FaultLogEntry[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (pumpId: string) => {
    setLoadingDetail(true);
    try {
      const [d, t, f] = await Promise.all([fetchPumpDetail(pumpId), fetchPumpTelemetry(pumpId, 24), fetchFaults(pumpId)]);
      setDetail(d ? {
        pump: d.pump || (d as any),
        latest_telemetry: d.latest_telemetry || null,
        config: d.config || null,
        open_fault_count: d.open_fault_count ?? 0
      } : null);

      const tList = Array.isArray(t) ? t : (t?.telemetry || (t as any)?.data || []);
      setTelemetry(Array.isArray(tList) ? tList : []);

      setFaults(f);
    } catch (err: any) {
      showToast(err.message || 'Could not load device diagnostics', true);
    } finally {
      setLoadingDetail(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selected) load(selected.id);
    else {
      setDetail(null);
      setTelemetry([]);
      setFaults([]);
    }
  }, [selected, load]);

  const safeTelemetry = Array.isArray(telemetry) ? telemetry : [];
  const safeFaults = Array.isArray(faults) ? faults : [];
  const pumpObj = detail?.pump || (detail as any) || null;

  async function handleCommand(action: 'START' | 'STOP') {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await dispatchCommand(selected.id, action);
      if (result.status === 200 || result.status === 202) {
        showToast(`${action} sent: waiting for the pump to confirm`);
        start(selected.id, result.cooldownSec || 45);
        if (result.command?.cid) {
          const pid = selected.id;
          watchCommand(pid, result.command.cid, cmd => {
            const outcome = outcomeOf(cmd, action);
            if (outcome) showToast(outcome.text, outcome.error);
          });
        }
      } else if (result.status === 429) {
        showToast(result.detail || result.error || result.message || 'Command cooldown active — 45s protection window', true);
        start(selected.id, 45);
      } else if (result.status === 409) {
        showToast(result.message || result.error || 'Command rejected', true);
        start(selected.id, result.remainingSec || 0);
      } else {
        showToast(result.detail || result.error || `Command failed (HTTP ${result.status})`, true);
      }
    } catch {
      showToast('Network error dispatching command', true);
    } finally {
      setBusy(false);
      load(selected.id);
    }
  }

  const telemetryColumns: GridColDef<TelemetryRow>[] = [
    { field: 'recorded_at', headerName: 'Check-in time', flex: 1.3, minWidth: 170, valueGetter: (_v, row) => new Date(row.recorded_at).toLocaleString() },
    { field: 'pump_on', headerName: 'Pump', flex: 0.6, minWidth: 90, renderCell: p => <Chip size="small" label={p.value ? 'ON' : 'OFF'} color={p.value ? 'success' : 'default'} /> },
    { field: 'fault_active', headerName: 'Fault', flex: 0.6, minWidth: 100, renderCell: p => (p.value ? <Chip size="small" label="ACTIVE" color="error" /> : '—') },
    { field: 'gsm_rssi', headerName: 'GSM RSSI', flex: 0.6, minWidth: 110, valueGetter: (_v, row) => (row.gsm_rssi != null ? `${row.gsm_rssi} dBm` : '—') },
    { field: 'seq', headerName: 'Seq', flex: 0.5, minWidth: 80, valueGetter: (_v, row) => row.seq ?? '—' },
    {
      field: 'flags',
      headerName: 'Flags',
      flex: 0.8,
      minWidth: 130,
      renderCell: p => (
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {p.row.buffered && <Chip size="small" label="buffered" variant="outlined" />}
          {p.row.ts_approx && <Chip size="small" label="ts~approx" variant="outlined" />}
        </Box>
      )
    }
  ];

  const selectedIsOn = pumpObj?.status === 'RUNNING';
  const cooldownRemaining = selected ? remaining[selected.id] : undefined;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 2 }}>
      <Box>
        <Typography variant="h4">Support Console</Typography>
        <Typography variant="caption" color="text.secondary">
          Per-device diagnostics — connection history, fault history and remote commands (FR-WEB-018)
        </Typography>
      </Box>

      <Autocomplete
        options={pumps}
        loading={pumpsLoading}
        value={selected}
        onChange={(_e, value) => setSelected(value)}
        getOptionLabel={p => `${p.name} — ${p.id}`}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        renderInput={params => <TextField {...params} label="Search device by name or ID" />}
        sx={{ maxWidth: 480 }}
      />

      {!selected ? (
        <Box sx={{ display: 'grid', placeItems: 'center', flex: 1 }}>
          <Typography color="text.secondary">Select a device to view diagnostics.</Typography>
        </Box>
      ) : loadingDetail || !detail || !pumpObj ? (
        <Box sx={{ display: 'grid', placeItems: 'center', flex: 1 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <Card elevation={1} sx={{ flexShrink: 0 }}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="h6">{pumpObj.name}</Typography>
                    <Chip size="small" label={pumpObj.status} color={pumpObj.status === 'FAULT' ? 'error' : pumpObj.status === 'RUNNING' ? 'success' : 'default'} />
                    <Chip size="small" label={pumpObj.lifecycle_state} variant="outlined" />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont, display: 'block' }}>
                    {pumpObj.id} · firmware {pumpObj.firmware_version || 'unreported'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Last seen: {pumpObj.last_seen_at ? new Date(pumpObj.last_seen_at).toLocaleString() : 'never'} · Open faults: {detail.open_fault_count ?? 0}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Button size="small" startIcon={<OpenInNewIcon fontSize="small" />} onClick={() => navigate(`/devices/${encodeURIComponent(pumpObj.id)}`)}>
                    Full device detail
                  </Button>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'background.surfaceVariant', borderRadius: 2, px: 1.5, py: 0.75 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>
                      Remote switch
                    </Typography>
                    {Boolean(cooldownRemaining) && <Chip size="small" label={`⏳ ${cooldownRemaining}s`} sx={{ bgcolor: `${theme.palette.m3.tertiary}22`, color: theme.palette.m3.tertiary }} />}
                    <Switch
                      checked={selectedIsOn}
                      disabled={busy || Boolean(cooldownRemaining)}
                      onChange={e => handleCommand(e.target.checked ? 'START' : 'STOP')}
                    />
                  </Box>
                </Box>
              </Box>
            </CardContent>
          </Card>

          <Card elevation={1} sx={{ flexShrink: 0 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Recent Faults
              </Typography>
              {safeFaults.length === 0 ? (
                <Alert severity="success" variant="outlined">
                  No faults recorded for this device.
                </Alert>
              ) : (
                <Stack spacing={1}>
                  {safeFaults.slice(0, 5).map(f => (
                    <Alert key={f.id} severity={SEVERITY_COLOR[f.severity || ''] || 'info'} variant="outlined">
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Typography variant="caption" sx={{ fontFamily: monoFont }}>
                          {new Date(f.occurred_at).toLocaleString()}
                        </Typography>
                        <Chip size="small" label={`Code ${f.fault_code} · ${f.fault_name || 'Unknown'}`} sx={{ fontFamily: monoFont }} />
                        {!f.resolved_at && <Chip size="small" label="Open" color="warning" variant="outlined" />}
                      </Box>
                    </Alert>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>

          <Card elevation={1} sx={{ flex: 1, minHeight: 320, display: 'flex', flexDirection: 'column' }}>
            <CardContent sx={{ pb: 0 }}>
              <Typography variant="h6">Connection History (last 24h)</Typography>
              <Typography variant="caption" color="text.secondary">
                Every row is a real reported telemetry check-in — there is no raw wire-message store to show below this.
              </Typography>
            </CardContent>
            <Box sx={{ flex: 1, minHeight: 0, p: 2 }}>
              {safeTelemetry.length === 0 ? (
                <Typography color="text.secondary">No telemetry received in the last 24 hours.</Typography>
              ) : (
                <DataGrid
                  rows={safeTelemetry}
                  columns={telemetryColumns}
                  getRowId={row => row.id ?? `${row.recorded_at}-${row.seq}`}
                  density="compact"
                  pageSizeOptions={[10, 25, 50]}
                  initialState={{ pagination: { paginationModel: { pageSize: 10 } }, sorting: { sortModel: [{ field: 'recorded_at', sort: 'desc' }] } }}
                  disableRowSelectionOnClick
                  showToolbar
                  sx={{ border: 'none', height: '100%' }}
                />
              )}
            </Box>
          </Card>
        </Box>
      )}
    </Box>
  );
};
