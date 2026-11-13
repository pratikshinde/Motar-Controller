import React, { useState, useEffect, useCallback } from 'react';
import { Alert, Box, Card, Chip, CircularProgress, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { fetchSystemHealth } from '../api/systemHealth';
import { useToast } from '../context/ToastContext';
import type { SystemHealth } from '../types';

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
}

const Tile: React.FC<{ label: string; value: React.ReactNode; hint?: string; bad?: boolean; testId: string }> = ({ label, value, hint, bad, testId }) => (
  <Card variant="outlined" data-testid={testId} sx={{ p: 2, borderRadius: 3, borderColor: bad ? 'error.main' : undefined }}>
    <Typography variant="body2" color="text.secondary">
      {label}
    </Typography>
    <Typography sx={{ fontSize: '1.6rem', fontWeight: 800, lineHeight: 1.2, color: bad ? 'error.main' : undefined }}>{value}</Typography>
    {hint && (
      <Typography variant="caption" color="text.secondary">
        {hint}
      </Typography>
    )}
  </Card>
);

/** Whether the platform is working, in plain words: is the server up, is the database answering, are the pumps' readings arriving. */
export const SystemHealthView: React.FC = () => {
  const theme = useTheme();
  const { showToast } = useToast();
  const [data, setData] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setData(await fetchSystemHealth());
    } catch (err: any) {
      showToast(err?.message || 'Could not load the platform health', true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
        <CircularProgress size={36} />
      </Box>
    );
  }
  if (!data) return <Alert severity="error">The platform health could not be read. Try again in a moment.</Alert>;

  const m: any = data.metrics || {};
  const proc: any = data.process || { uptime_seconds: (data as any)?.uptime_seconds || 0 };
  const db: any = data.database && typeof data.database === 'object' ? data.database : { connected: false, latency_ms: null };

  const requests: number = m.requests_total ?? m.http_requests_total ?? 0;
  const serverErrors: number = m.errors_5xx ?? m.http_errors_5xx ?? 0;
  const readingsOk: number = m.telemetry_ingest_success ?? 0;
  const readingsBad: number = m.telemetry_ingest_failure ?? 0;
  const dbUp = Boolean(db.connected);

  // What is wrong, if anything, said so that anyone can act on it.
  const problems: string[] = [];
  if (data.status !== 'OK') problems.push('The server reports that it is not well.');
  if (!dbUp) problems.push('The database is not answering.');
  if (serverErrors > 0 && requests > 0 && serverErrors / requests > 0.05) problems.push('More than 1 in 20 requests is failing on the server.');
  if (readingsBad > 0 && readingsBad > readingsOk) problems.push('Most pump readings are being rejected.');
  const ok = problems.length === 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          Is the platform working? This page refreshes by itself.
        </Typography>
        <Tooltip title="Refresh now">
          <IconButton size="small" onClick={load} sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: 1.5 }} aria-label="Refresh now">
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      <Card
        variant="outlined"
        data-testid="health-banner"
        sx={{ p: 2.5, borderRadius: 3, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', borderColor: ok ? 'success.main' : 'error.main' }}
      >
        {ok ? <CheckCircleIcon color="success" /> : <ErrorIcon color="error" />}
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '1.1rem' }}>{ok ? 'Everything is working' : 'Something needs attention'}</Typography>
          {!ok && (
            <Box component="ul" sx={{ m: 0, pl: 2.5 }} data-testid="health-problems">
              {problems.map(p => (
                <li key={p}>
                  <Typography variant="body2">{p}</Typography>
                </li>
              ))}
            </Box>
          )}
        </Box>
        <Chip size="small" color={ok ? 'success' : 'error'} label={ok ? 'Healthy' : 'Not healthy'} />
      </Card>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' } }}>
        <Tile testId="tile-uptime" label="Server running for" value={formatUptime(proc.uptime_seconds || 0)} hint="since it last restarted" />
        <Tile
          testId="tile-database"
          label="Database"
          value={dbUp ? 'Working' : 'Not answering'}
          hint={dbUp && db.latency_ms != null ? `answers in ${db.latency_ms} ms` : undefined}
          bad={!dbUp}
        />
        <Tile testId="tile-readings" label="Pump readings received" value={readingsOk} hint={readingsBad > 0 ? `${readingsBad} rejected` : 'none rejected'} bad={readingsBad > readingsOk && readingsBad > 0} />
        <Tile testId="tile-errors" label="Server errors" value={serverErrors} hint={`out of ${requests} requests`} bad={requests > 0 && serverErrors / requests > 0.05} />
      </Box>
    </Box>
  );
};
