import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Card, CardContent, Typography, ToggleButtonGroup, ToggleButton, CircularProgress, Chip } from '@mui/material';
import { LineChart } from '@mui/x-charts/LineChart';
import { fetchPumpTelemetry } from '../../api/pumps';
import { useToast } from '../../context/ToastContext';
import { useWs } from '../../context/WebSocketContext';
import { pumpUpdateToTelemetryRow } from '../../utils/wsMerge';
import type { TelemetryRow } from '../../types';

const RANGES = [
  { label: '24h', hours: 24 },
  { label: '7d', hours: 24 * 7 },
  { label: '30d', hours: 24 * 30 }
];

export const TrendsTab: React.FC<{ pumpId: string }> = ({ pumpId }) => {
  const { showToast } = useToast();
  const { subscribe } = useWs();
  const [hours, setHours] = useState(24);
  const [rows, setRows] = useState<TelemetryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPumpTelemetry(pumpId, hours);
      setRows(data.telemetry);
    } catch (err: any) {
      showToast(err.message || 'Could not load telemetry history', true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pumpId, hours]);

  useEffect(() => {
    load();
  }, [load]);

  // Append newly-arrived points live rather than waiting for the next
  // range reload — only meaningful while viewing the window that would
  // actually contain "now" (24h); older windows are historical by
  // definition and shouldn't grow live.
  //
  // The FastAPI ws_hub shape: { type:"telemetry", pump_id:"...", data:{v_ry,...,recorded_at} }
  useEffect(() => {
    if (hours !== 24) return;
    return subscribe('telemetry', msg => {
      if (msg.pump_id !== pumpId) return;
      const src = msg.data || msg.pump || msg;
      if (!src.recorded_at) return;
      const row: TelemetryRow = {
        recorded_at: src.recorded_at,
        v_ry: src.v_ry ?? null,
        v_yb: src.v_yb ?? null,
        v_br: src.v_br ?? null,
        i_r: src.i_r ?? null,
        i_y: src.i_y ?? null,
        i_b: src.i_b ?? null,
        pump_on: src.pump_on ?? false,
        fault_active: src.fault_active ?? false,
        gsm_rssi: src.gsm_rssi ?? null,
        seq: src.seq ?? null,
        ts_approx: src.ts_approx ?? false,
        buffered: src.buffered ?? false,
      };
      setRows(prev => (
        prev.length && prev[prev.length - 1].recorded_at === row.recorded_at
          ? prev
          : [...prev, row]
      ));
    });
  }, [pumpId, hours, subscribe]);

  const xAxisData = useMemo(() => rows.map(r => new Date(r.recorded_at)), [rows]);
  const bufferedCount = useMemo(() => rows.filter(r => r.buffered).length, [rows]);
  const approxCount = useMemo(() => rows.filter(r => r.ts_approx).length, [rows]);

  const num = (v: string | null) => (v === null ? null : Number(v));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
        <ToggleButtonGroup value={hours} exclusive size="small" onChange={(_, v) => v && setHours(v)}>
          {RANGES.map(r => (
            <ToggleButton key={r.hours} value={r.hours}>
              {r.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {bufferedCount > 0 && <Chip size="small" label={`${bufferedCount} buffered points`} />}
          {approxCount > 0 && <Chip size="small" label={`${approxCount} approximate timestamps`} />}
        </Box>
      </Box>

      {loading ? (
        <Box sx={{ display: 'grid', placeItems: 'center', height: 240 }}>
          <CircularProgress />
        </Box>
      ) : rows.length === 0 ? (
        <Typography color="text.secondary">No telemetry recorded in this window.</Typography>
      ) : (
        <>
          <Card elevation={1}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Voltage (V)
              </Typography>
              <LineChart
                height={260}
                xAxis={[{ data: xAxisData, scaleType: 'time' }]}
                series={[
                  { data: rows.map(r => num(r.v_ry)), label: 'R-Y', showMark: false },
                  { data: rows.map(r => num(r.v_yb)), label: 'Y-B', showMark: false },
                  { data: rows.map(r => num(r.v_br)), label: 'B-R', showMark: false }
                ]}
              />
            </CardContent>
          </Card>

          <Card elevation={1}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Current (A)
              </Typography>
              <LineChart
                height={260}
                xAxis={[{ data: xAxisData, scaleType: 'time' }]}
                series={[
                  { data: rows.map(r => num(r.i_r)), label: 'Ph R', showMark: false },
                  { data: rows.map(r => num(r.i_y)), label: 'Ph Y', showMark: false },
                  { data: rows.map(r => num(r.i_b)), label: 'Ph B', showMark: false }
                ]}
              />
            </CardContent>
          </Card>
        </>
      )}
    </Box>
  );
};
