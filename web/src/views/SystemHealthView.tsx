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
  <Card elevation={1} sx={{ p: 1.5, borderRadius: 2, border: theme => `1px solid ${theme.palette.divider}` }}>
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{ display: 'block', fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', mb: 0.5 }}
    >
      {label}
    </Typography>
    <Typography variant="h4" sx={{ color, fontFamily: monoFont, fontWeight: 700, fontSize: '1.35rem', lineHeight: 1.1 }}>
      {value}
    </Typography>
  </Card>
);

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
        <CircularProgress size={36} />
      </Box>
    );
  }
  if (!data) return null;

  const m = data.metrics || {};
  const proc = data.process || { uptime_seconds: (data as any)?.uptime_seconds || 0, env: '—' };
  const dbInfo: any = data.database && typeof data.database === 'object' ? data.database : { connected: false, latency_ms: null, pool_total: null, pool_idle: null, pool_waiting: null };
  const num = (v: unknown) => (typeof v === 'number' ? String(v) : '—');

  const totalReqs: number = m.requests_total ?? m.http_requests_total ?? 0;
  const err4xx: number   = m.errors_4xx     ?? m.http_errors_4xx     ?? 0;
  const err5xx: number   = m.errors_5xx     ?? m.http_errors_5xx     ?? 0;
  const sms_sent: number    = m.sms_sent    ?? 0;
  const sms_failed: number  = m.sms_failed  ?? 0;
  const wa_sent: number     = m.whatsapp_sent   ?? 0;
  const wa_failed: number   = m.whatsapp_failed ?? 0;
  const ingest_ok: number   = m.telemetry_ingest_success ?? 0;
  const ingest_fail: number = m.telemetry_ingest_failure ?? 0;
  const errorRate = totalReqs > 0 ? (((err4xx + err5xx) / totalReqs) * 100).toFixed(1) : '0.0';

  const isHealthy = data.status === 'OK' && dbInfo.connected;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, height: '100%', overflowY: 'auto' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1.5 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '1.25rem' }}>
            System Diagnostics &amp; Infrastructure Health
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
            FastAPI application runtime telemetry, PostgreSQL connection pooling, and message broker diagnostics
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Chip
            label={isHealthy ? 'System Operational' : 'Degraded Performance'}
            sx={{
              height: 24,
              fontSize: '0.75rem',
              fontWeight: 700,
              bgcolor: isHealthy ? 'secondaryContainer' : 'errorContainer',
              color: isHealthy ? 'onSecondaryContainer' : 'onErrorContainer',
              border: `1px solid ${isHealthy ? theme.palette.secondary.main : theme.palette.error.main}33`
            }}
          />
          <Tooltip title="Refresh metrics snapshot">
            <IconButton size="small" onClick={load} sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: 1.5, p: 0.75 }}>
              <RefreshIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Primary KPI Grid */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' }, gap: 1.5 }}>
        <StatTile label="Process Uptime" value={formatUptime(proc.uptime_seconds || 0)} />
        <StatTile label="HTTP Ingress Volume" value={totalReqs} color="primary.main" />
        <StatTile
          label="Error Rate"
          value={`${errorRate}%`}
          color={Number(errorRate) > 5 ? theme.palette.error.main : theme.palette.secondary.main}
        />
        <StatTile
          label="Database Pool (Idle / Total)"
          value={`${num(dbInfo.pool_idle)} / ${num(dbInfo.pool_total)}`}
          color={dbInfo.connected ? undefined : theme.palette.error.main}
        />
      </Box>

      {/* Detailed Diagnostic Panels */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
        <Card elevation={1} sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '0.9375rem', pb: 1, borderBottom: `1px solid ${theme.palette.divider}` }}>
              HTTP API &amp; PostgreSQL Service Layer
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Row label="4xx Client Rejections" value={err4xx} />
              <Row label="5xx Internal Server Exceptions" value={err5xx} highlight={err5xx > 0} />
              <Row label="Database Engine Connection" value={dbInfo.connected ? 'Connected (Active)' : 'Disconnected'} highlight={!dbInfo.connected} />
              <Row label="Database Ping Latency" value={dbInfo.latency_ms != null ? `${dbInfo.latency_ms} ms` : '—'} />
              <Row label="Active Connections in Use" value={num(dbInfo.pool_in_use)} />
              <Row label="Runtime Environment" value={proc.env || 'production'} />
              <Row label="Python Core Version" value={(proc as any).python_version || '3.11'} />
            </Box>
          </CardContent>
        </Card>

        <Card elevation={1} sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '0.9375rem', pb: 1, borderBottom: `1px solid ${theme.palette.divider}` }}>
              Telemetry Pipeline &amp; Outbound Dispatch
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Row label="Telemetry Packets Ingested" value={ingest_ok} />
              <Row label="Ingest Rejections / Parse Errors" value={ingest_fail} highlight={ingest_fail > 0} />
              <Row label="SMS Dispatches" value={sms_sent} />
              <Row label="SMS Delivery Failures" value={sms_failed} highlight={sms_failed > 0} />
              <Row label="WhatsApp Messages Dispatched" value={wa_sent} />
              <Row label="WhatsApp Dispatch Failures" value={wa_failed} highlight={wa_failed > 0} />
            </Box>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
};

const Row: React.FC<{ label: string; value: React.ReactNode; highlight?: boolean }> = ({ label, value, highlight }) => (
  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.5, borderBottom: theme => `1px solid ${theme.palette.divider}` }}>
    <Typography variant="body2" color="text.secondary">
      {label}
    </Typography>
    <Typography variant="body2" sx={{ fontFamily: monoFont, fontWeight: 700, color: highlight ? 'error.main' : 'text.primary' }}>
      {value}
    </Typography>
  </Box>
);
