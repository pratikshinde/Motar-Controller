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
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1.5 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '1.25rem' }}>
            Fault Incident &amp; Protection Trip Logs
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
            Historical hardware trips, dry-run cutoffs, thermal overloads, and manual operator resets
          </Typography>
        </Box>
        <FormControl size="small" sx={{ minWidth: 260 }}>
          <InputLabel id="pump-select-label">Select Pump Device</InputLabel>
          <Select labelId="pump-select-label" label="Select Pump Device" value={selectedPumpId} onChange={e => setSelectedPumpId(e.target.value)}>
            {safePumps.map(p => (
              <MenuItem key={p.id} value={p.id}>
                {p.name} ({p.id})
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', height: '100%' }}>
            <CircularProgress size={36} />
          </Box>
        ) : safeFaults.length === 0 ? (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              py: 8,
              border: theme => `1px dashed ${theme.palette.divider}`,
              borderRadius: 2
            }}
          >
            <Typography variant="body1" sx={{ fontWeight: 600, color: 'text.primary', mb: 0.5 }}>
              No fault trip events recorded
            </Typography>
            <Typography variant="body2" color="text.secondary">
              This device has recorded zero hardware fault trip interrupts.
            </Typography>
          </Box>
        ) : (
          <Stack spacing={1.5}>
            {safeFaults.map(f => {
              const sev = f.severity || 'LOW';
              const sevColor = sev === 'CRITICAL' || sev === 'HIGH' ? '#DC2626' : sev === 'MEDIUM' ? '#D97706' : '#2563EB';
              return (
                <Box
                  key={f.id}
                  sx={{
                    display: 'flex',
                    flexDirection: { xs: 'column', sm: 'row' },
                    alignItems: { xs: 'flex-start', sm: 'center' },
                    justifyContent: 'space-between',
                    gap: 1.5,
                    p: 2,
                    borderRadius: 2,
                    border: theme => `1px solid ${theme.palette.divider}`,
                    borderLeft: `4px solid ${sevColor}`,
                    bgcolor: 'background.paper',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.03)'
                  }}
                >
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.5 }}>
                      <Chip
                        size="small"
                        label={`Trip #${f.fault_code}`}
                        sx={{
                          height: 20,
                          fontSize: '0.6875rem',
                          fontWeight: 700,
                          bgcolor: `${sevColor}18`,
                          color: sevColor,
                          border: `1px solid ${sevColor}33`,
                          fontFamily: monoFont
                        }}
                      />
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {f.fault_name || 'Hardware Fault Trip'}
                      </Typography>
                      {f.severity && (
                        <Chip size="small" label={f.severity} sx={{ height: 20, fontSize: '0.6875rem', fontWeight: 600 }} />
                      )}
                      {f.resolved_at && (
                        <Chip
                          size="small"
                          label="Resolved"
                          color="success"
                          variant="outlined"
                          sx={{ height: 20, fontSize: '0.6875rem' }}
                        />
                      )}
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont, display: 'block' }}>
                      Occurred: {new Date(f.occurred_at).toLocaleString()}
                      {f.ack_at && ` • Acknowledged: ${new Date(f.ack_at).toLocaleTimeString()}`}
                    </Typography>
                    {f.description && (
                      <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
                        {f.description}
                      </Typography>
                    )}
                  </Box>

                  {!f.ack_at && (
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => handleAck(f.id)}
                      sx={{ height: 30, fontSize: '0.75rem', flexShrink: 0 }}
                    >
                      Acknowledge &amp; Reset
                    </Button>
                  )}
                </Box>
              );
            })}
          </Stack>
        )}
      </Box>
    </Box>
  );
};
