import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, FormControl, InputLabel, Select, MenuItem, Card, Alert,
  Button, Stack, Chip, CircularProgress
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { usePumps } from '../hooks/usePumps';
import { fetchFaults, ackFault } from '../api/faults';
import { useToast } from '../context/ToastContext';
import { monoFont } from '../theme';
import type { FaultLogEntry } from '../types';

const SEVERITY_MAP: Record<string, 'error' | 'warning' | 'info'> = {
  CRITICAL: 'error',
  HIGH: 'warning',
  MEDIUM: 'warning',
  LOW: 'info'
};

export const FaultLogsView: React.FC = () => {
  const theme = useTheme();
  const { pumps } = usePumps();
  const { showToast } = useToast();
  const [selectedPumpId, setSelectedPumpId] = useState('');
  const [faults, setFaults] = useState<FaultLogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const safePumps = Array.isArray(pumps) ? pumps : [];
  const safeFaults = Array.isArray(faults) ? faults : [];

  useEffect(() => {
    if (!selectedPumpId && safePumps.length > 0) setSelectedPumpId(safePumps[0].id);
  }, [safePumps, selectedPumpId]);

  const load = useCallback(async (pumpId: string) => {
    if (!pumpId) return;
    setLoading(true);
    try {
      setFaults(await fetchFaults(pumpId));
    } catch {
      showToast('Could not load fault log', true);
      setFaults([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedPumpId) load(selectedPumpId);
  }, [selectedPumpId, load]);

  async function handleAck(faultId: number) {
    try {
      await ackFault(selectedPumpId, faultId, true);
      showToast('Fault acknowledged & resolved');
      load(selectedPumpId);
    } catch (err: any) {
      showToast(err.message || 'Could not acknowledge fault', true);
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
        <Typography variant="h4" sx={{ color: theme.palette.error.main }}>
          Fleet Fault Incident &amp; Protection Logs
        </Typography>
        <FormControl size="small" sx={{ minWidth: 240 }}>
          <InputLabel id="pump-select-label">Pump</InputLabel>
          <Select labelId="pump-select-label" label="Pump" value={selectedPumpId} onChange={e => setSelectedPumpId(e.target.value)}>
            {safePumps.map(p => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', height: '100%' }}>
            <CircularProgress />
          </Box>
        ) : safeFaults.length === 0 ? (
          <Alert severity="success" variant="outlined">
            No fault events recorded for this pump.
          </Alert>
        ) : (
          <Stack spacing={1.5}>
            {safeFaults.map(f => (
              <Alert
                key={f.id}
                severity={SEVERITY_MAP[f.severity || ''] || 'info'}
                variant="outlined"
                action={
                  !f.ack_at ? (
                    <Button size="small" onClick={() => handleAck(f.id)}>
                      Acknowledge
                    </Button>
                  ) : undefined
                }
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="caption" sx={{ fontFamily: monoFont }}>
                    {new Date(f.occurred_at).toLocaleString()}
                  </Typography>
                  <Chip size="small" label={`Code ${f.fault_code} · ${f.fault_name || 'Unknown'}`} sx={{ fontFamily: monoFont }} />
                  {f.severity && <Chip size="small" label={f.severity} color={SEVERITY_MAP[f.severity]} variant="outlined" />}
                  {f.resolved_at && <Chip size="small" label={`Resolved ${new Date(f.resolved_at).toLocaleString()}`} color="success" variant="outlined" />}
                </Box>
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  {f.description}
                </Typography>
              </Alert>
            ))}
          </Stack>
        )}
      </Box>
    </Box>
  );
};
