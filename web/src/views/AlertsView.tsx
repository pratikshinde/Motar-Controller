import React, { useState, useEffect, useCallback } from 'react';
import { Box, Button, Chip, CircularProgress, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import { useNavigate } from 'react-router-dom';
import { fetchAlerts, type AlertFilters } from '../api/alerts';
import { useWs } from '../context/WebSocketContext';
import { useToast } from '../context/ToastContext';
import { ResolveAlertDialog } from '../components/ResolveAlertDialog';
import { timeAgo } from '../utils/timeAgo';
import type { AlertRow } from '../types';

type Show = 'open' | 'resolved' | 'all';

/** What happened, in words anyone reads at a glance. */
export const alertText = (a: Pick<AlertRow, 'alert_type' | 'fault_name' | 'fault_code'>) =>
  a.alert_type === 'FAULT' ? a.fault_name || (a.fault_code !== null ? `Fault ${a.fault_code}` : 'Pump fault') : 'Pump went offline';

/** The pumps that need attention: what happened, to which pump and when. Resolve one when it has been dealt with. */
export const AlertsView: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { subscribe } = useWs();
  const { showToast } = useToast();
  const [show, setShow] = useState<Show>('open');
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolveTarget, setResolveTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const status: AlertFilters['status'] | undefined = show === 'all' ? undefined : show;
      const data = await fetchAlerts({ status });
      const list = Array.isArray(data) ? data : data?.alerts || (data as any)?.data || [];
      setAlerts(list);
    } catch (err: any) {
      showToast(err?.message || 'Could not load the alerts', true);
      setAlerts([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // A new alert shows up without a refresh.
  useEffect(() => {
    const a = subscribe('alert', load);
    const b = subscribe('alert_digest', load);
    return () => {
      a();
      b();
    };
  }, [subscribe, load]);

  const red = theme.palette.error.main;
  const amber = theme.palette.warning.main;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          Pumps that need attention. Mark one resolved when it has been dealt with.
        </Typography>
        <ToggleButtonGroup value={show} exclusive size="small" onChange={(_, v: Show | null) => v && setShow(v)}>
          <ToggleButton value="open" data-testid="show-open">Open</ToggleButton>
          <ToggleButton value="resolved" data-testid="show-resolved">Resolved</ToggleButton>
          <ToggleButton value="all" data-testid="show-all">All</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {loading ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
          <CircularProgress size={36} />
        </Box>
      ) : alerts.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 8, border: `1px dashed ${theme.palette.divider}`, borderRadius: 3 }} data-testid="no-alerts">
          <CheckCircleOutlineIcon sx={{ fontSize: 36, color: 'success.main', mb: 1 }} />
          <Typography sx={{ fontWeight: 700 }}>{show === 'resolved' ? 'Nothing resolved yet' : 'All clear'}</Typography>
          <Typography variant="body2" color="text.secondary">
            {show === 'open' ? 'No pump needs attention right now.' : 'There are no alerts to show here.'}
          </Typography>
        </Box>
      ) : (
        <Stack spacing={1.5}>
          {alerts.map(a => {
            const urgent = a.severity === 'CRITICAL' || a.severity === 'HIGH';
            const color = a.resolved_at ? theme.palette.success.main : urgent ? red : amber;
            return (
              <Box
                key={a.id}
                data-testid={`alert-${a.id}`}
                sx={{
                  display: 'flex',
                  flexDirection: { xs: 'column', sm: 'row' },
                  alignItems: { xs: 'flex-start', sm: 'center' },
                  justifyContent: 'space-between',
                  gap: 1.5,
                  p: 2,
                  borderRadius: 3,
                  border: `1px solid ${theme.palette.divider}`,
                  borderLeft: `5px solid ${color}`,
                  bgcolor: 'background.paper'
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                    <Typography sx={{ fontWeight: 800 }}>{alertText(a)}</Typography>
                    {urgent && !a.resolved_at && <Chip size="small" color="error" label="Urgent" sx={{ height: 20 }} />}
                    {a.occurrence_count > 1 && <Chip size="small" variant="outlined" label={`${a.occurrence_count} times`} sx={{ height: 20 }} />}
                  </Stack>
                  <Typography
                    variant="body2"
                    sx={{ cursor: 'pointer', color: 'primary.main', '&:hover': { textDecoration: 'underline' }, display: 'inline-block' }}
                    onClick={() => navigate(`/devices/${encodeURIComponent(a.pump_id)}`)}
                  >
                    {a.pump_name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {timeAgo(a.last_occurred_at)}
                    {a.resolved_at ? ` · resolved ${timeAgo(a.resolved_at)}` : ''}
                  </Typography>
                  {a.resolution_note && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontStyle: 'italic' }}>
                      {a.resolution_note}
                    </Typography>
                  )}
                </Box>
                {!a.resolved_at && (
                  <Button variant="contained" size="small" onClick={() => setResolveTarget(a.id)} data-testid={`resolve-${a.id}`} sx={{ flexShrink: 0 }}>
                    Resolve
                  </Button>
                )}
              </Box>
            );
          })}
        </Stack>
      )}

      <ResolveAlertDialog open={resolveTarget !== null} alertId={resolveTarget} onClose={() => setResolveTarget(null)} onResolved={load} />
    </Box>
  );
};
