import React, { useState, useEffect, useCallback } from 'react';
import { Box, Typography, Card, CardContent, Chip, CircularProgress, IconButton, Tooltip } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTheme } from '@mui/material/styles';
import { fetchSystemHealth } from '../api/systemHealth';
import { useToast } from '../context/ToastContext';
import { monoFont } from '../theme';
import type { SystemHealth } from '../types';

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const StatTile: React.FC<{ label: string; value: React.ReactNode; color?: string }> = ({ label, value, color }) => (
  <Card elevation={1}>
    <CardContent>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h4" sx={{ color, fontFamily: monoFont }}>
        {value}
      </Typography>
    </CardContent>
  </Card>
);

// FR-WEB-017 — every number rendered here traces to a real live read or a
// counter incremented at the exact backend code path it names (see
// backend/services/metrics.js). There is no time-series storage for these
// counters, so this is a live snapshot with a manual/periodic refresh, not
// a trend chart — a sparkline here would have to fabricate history that
// doesn't exist.
export const SystemHealthView: React.FC = () => {
  const theme = useTheme();
  const { showToast } = useToast();
  const [data, setData] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const health = await fetchSystemHealth();
      setData(health);
    } catch (err: any) {
      showToast(err.message || 'Could not load system health', true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!data) return null;

  const m = data.metrics;
  const errorRate = m.http_requests_total > 0 ? (((m.http_errors_4xx + m.http_errors_5xx) / m.http_requests_total) * 100).toFixed(1) : '0.0';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%', overflowY: 'auto' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h4">System Health</Typography>
          <Typography variant="caption" color="text.secondary">
            Live process metrics (FR-WEB-017) — auto-refreshes every 15s
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip
            label={data.status}
            color={data.status === 'OK' ? 'success' : 'error'}
            sx={{ fontWeight: 700 }}
          />
          <Tooltip title="Refresh now">
            <IconButton onClick={load}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr 1fr' }, gap: 2 }}>
        <StatTile label="Process uptime" value={formatUptime(data.process.uptime_seconds)} />
        <StatTile label="HTTP requests" value={m.http_requests_total} />
        <StatTile
          label="Error rate"
          value={`${errorRate}%`}
          color={Number(errorRate) > 5 ? theme.palette.error.main : undefined}
        />
        <StatTile
          label="DB pool"
          value={`${data.database.pool_idle}/${data.database.pool_total}`}
          color={data.database.connected ? undefined : theme.palette.error.main}
        />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
        <Card elevation={1}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              HTTP &amp; Database
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Row label="4xx responses" value={m.http_errors_4xx} />
              <Row label="5xx responses" value={m.http_errors_5xx} highlight={m.http_errors_5xx > 0} />
              <Row label="DB connected" value={data.database.connected ? 'Yes' : 'No'} highlight={!data.database.connected} />
              <Row label="DB round-trip latency" value={data.database.latency_ms != null ? `${data.database.latency_ms} ms` : '—'} />
              <Row label="Pool: total / idle / waiting" value={`${data.database.pool_total} / ${data.database.pool_idle} / ${data.database.pool_waiting}`} />
              <Row label="Node version" value={data.process.node_version} />
              <Row label="NODE_ENV" value={data.process.env} />
            </Box>
          </CardContent>
        </Card>

        <Card elevation={1}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Telemetry Ingestion &amp; Notifications
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Row label="Telemetry ingested (success)" value={m.telemetry_ingest_success} />
              <Row label="Telemetry ingest failures" value={m.telemetry_ingest_failure} highlight={m.telemetry_ingest_failure > 0} />
              <Row label="SMS dispatched" value={m.sms_sent} />
              <Row label="SMS dispatch failures" value={m.sms_failed} highlight={m.sms_failed > 0} />
              <Row label="WhatsApp dispatched" value={m.whatsapp_sent} />
              <Row label="WhatsApp dispatch failures" value={m.whatsapp_failed} highlight={m.whatsapp_failed > 0} />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
              "Dispatched" means the send call completed without throwing — no delivery-receipt webhook is wired up,
              so this is not confirmation of receipt on the handset.
            </Typography>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
};

const Row: React.FC<{ label: string; value: React.ReactNode; highlight?: boolean }> = ({ label, value, highlight }) => (
  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
    <Typography variant="body2" color="text.secondary">
      {label}
    </Typography>
    <Typography variant="body2" sx={{ fontFamily: monoFont, fontWeight: 700, color: highlight ? 'error.main' : undefined }}>
      {value}
    </Typography>
  </Box>
);
