import React, { useState, useEffect, useCallback } from 'react';
import { Box, Alert, Button, Chip, Stack, CircularProgress, Typography } from '@mui/material';
import { fetchFaults, ackFault } from '../../api/faults';
import { useToast } from '../../context/ToastContext';
import { monoFont } from '../../theme';
import type { FaultLogEntry } from '../../types';

const SEVERITY_MAP: Record<string, 'error' | 'warning' | 'info'> = {
  CRITICAL: 'error',
  HIGH: 'warning',
  MEDIUM: 'warning',
  LOW: 'info'
};

export const EventsTab: React.FC<{ pumpId: string }> = ({ pumpId }) => {
  const { showToast } = useToast();
  const [faults, setFaults] = useState<FaultLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setFaults(await fetchFaults(pumpId));
    } catch {
      showToast('Could not load event log', true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pumpId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAck(faultId: number) {
    try {
      await ackFault(pumpId, faultId, true);
      showToast('Event acknowledged & resolved');
      load();
    } catch (err: any) {
      showToast(err.message || 'Could not acknowledge event', true);
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: 200 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (faults.length === 0) {
    return (
      <Alert severity="success" variant="outlined">
        No events recorded for this device.
      </Alert>
    );
  }

  return (
    <Stack spacing={1.5}>
      {faults.map(f => (
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
            {f.contactor_tripped && <Chip size="small" label="Contactor tripped" variant="outlined" />}
            {f.resolved_at && <Chip size="small" label={`Resolved ${new Date(f.resolved_at).toLocaleString()}`} color="success" variant="outlined" />}
          </Box>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {f.description}
          </Typography>
          {f.v_yb_snapshot !== null && (
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }}>
              Y-B snapshot at trip: {f.v_yb_snapshot} V
            </Typography>
          )}
        </Alert>
      ))}
    </Stack>
  );
};
