import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, FormControl, InputLabel, Select, MenuItem, Alert, Button,
  Stack, Chip, CircularProgress
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { fetchAlerts, ackAlert, type AlertFilters } from '../api/alerts';
import { useAuth } from '../context/AuthContext';
import { useWs } from '../context/WebSocketContext';
import { useToast } from '../context/ToastContext';
import { AssignAlertDialog } from '../components/AssignAlertDialog';
import { ResolveAlertDialog } from '../components/ResolveAlertDialog';
import { AlertSubscriptionsDialog } from '../components/AlertSubscriptionsDialog';
import { monoFont } from '../theme';
import type { AlertRow } from '../types';

const SEVERITY_MAP: Record<string, 'error' | 'warning' | 'info'> = {
  CRITICAL: 'error',
  HIGH: 'warning',
  MEDIUM: 'warning',
  LOW: 'info'
};

// FR-WEB-060/062/063 — scoped down (17 Aug 2026): in-app only, no
// SMS/email/push service. Alerts here are already deduplicated and
// severity-real (server-computed, see backend/services/alertEngine.js) —
// nothing on this page is a raw fault re-notification.
export const AlertsView: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { subscribe } = useWs();
  const { showToast } = useToast();
  // Subscriptions default to "everything in scope" with zero rows (see
  // AlertSubscriptionsDialog) — the narrowing/muting controls are a
  // multi-device power-user tool (dealer/distributor/manufacturer
  // managing a fleet), not something a single-pump end customer needs to
  // touch to receive alerts at all.
  const canManageSubscriptions = user?.role !== 'customer';

  const [status, setStatus] = useState<AlertFilters['status'] | ''>('open');
  const [severity, setSeverity] = useState('');
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [subscriptionsOpen, setSubscriptionsOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<string | null>(null);
  const [resolveTarget, setResolveTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchAlerts({ status: status || undefined, severity: severity || undefined });
      const alertList = Array.isArray(data) ? data : (data?.alerts || (data as any)?.data || []);
      setAlerts(alertList);
    } catch (err: any) {
      showToast(err.message || 'Could not load alerts', true);
      setAlerts([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, severity]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // A live alert while this view is open should show up without a manual
  // refresh — cheaper to re-fetch than reconcile the digest/single-alert
  // shapes locally, same reasoning FleetDashboardView uses for 'fault'.
  useEffect(() => {
    const unsubAlert = subscribe('alert', load);
    const unsubDigest = subscribe('alert_digest', load);
    return () => {
      unsubAlert();
      unsubDigest();
    };
  }, [subscribe, load]);

  async function handleAck(id: string) {
    try {
      await ackAlert(id);
      showToast('Alert acknowledged');
      load();
    } catch (err: any) {
      showToast(err.message || 'Could not acknowledge alert', true);
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
        <Typography variant="h4">Alerts</Typography>
        <Stack direction="row" spacing={1.5}>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="alert-status-label">Status</InputLabel>
            <Select labelId="alert-status-label" label="Status" value={status} onChange={e => setStatus(e.target.value as AlertFilters['status'])}>
              <MenuItem value="open">Open</MenuItem>
              <MenuItem value="acknowledged">Acknowledged</MenuItem>
              <MenuItem value="resolved">Resolved</MenuItem>
              <MenuItem value="">All</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="alert-severity-label">Severity</InputLabel>
            <Select labelId="alert-severity-label" label="Severity" value={severity} onChange={e => setSeverity(e.target.value)}>
              <MenuItem value="">All severities</MenuItem>
              <MenuItem value="CRITICAL">Critical</MenuItem>
              <MenuItem value="HIGH">High</MenuItem>
              <MenuItem value="MEDIUM">Medium</MenuItem>
              <MenuItem value="LOW">Low</MenuItem>
            </Select>
          </FormControl>
          {canManageSubscriptions && (
            <Button variant="tonal" onClick={() => setSubscriptionsOpen(true)}>
              Manage Subscriptions
            </Button>
          )}
        </Stack>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', height: '100%' }}>
            <CircularProgress />
          </Box>
        ) : alerts.length === 0 ? (
          <Alert severity="success" variant="outlined">
            No alerts match this filter.
          </Alert>
        ) : (
          <Stack spacing={1.5}>
            {alerts.map(a => (
              <Alert
                key={a.id}
                severity={SEVERITY_MAP[a.severity] || 'info'}
                variant="outlined"
                action={
                  <Stack direction="row" spacing={0.5}>
                    {!a.acknowledged_at && (
                      <Button size="small" onClick={() => handleAck(a.id)}>
                        Ack
                      </Button>
                    )}
                    {!a.resolved_at && (
                      <Button size="small" onClick={() => setAssignTarget(a.id)}>
                        Assign
                      </Button>
                    )}
                    {!a.resolved_at && (
                      <Button size="small" onClick={() => setResolveTarget(a.id)}>
                        Resolve
                      </Button>
                    )}
                  </Stack>
                }
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="caption" sx={{ fontFamily: monoFont }}>
                    {new Date(a.last_occurred_at).toLocaleString()}
                  </Typography>
                  <Chip
                    size="small"
                    label={a.pump_name}
                    variant="outlined"
                    onClick={() => navigate(`/devices/${encodeURIComponent(a.pump_id)}`)}
                    sx={{ cursor: 'pointer' }}
                  />
                  <Chip size="small" label={a.severity} color={SEVERITY_MAP[a.severity]} variant="outlined" />
                  <Chip
                    size="small"
                    label={a.alert_type === 'FAULT' ? a.fault_name || `Code ${a.fault_code}` : 'Offline'}
                    sx={{ fontFamily: monoFont }}
                  />
                  {a.occurrence_count > 1 && <Chip size="small" label={`×${a.occurrence_count}`} variant="outlined" />}
                  {a.acknowledged_at && (
                    <Chip size="small" color="success" variant="outlined" label={`Acked${a.acknowledged_by_name ? ' · ' + a.acknowledged_by_name : ''}`} />
                  )}
                  {a.assigned_to_name && <Chip size="small" variant="outlined" label={`Assigned · ${a.assigned_to_name}`} />}
                  {a.resolved_at && <Chip size="small" color="success" label={`Resolved ${new Date(a.resolved_at).toLocaleString()}`} />}
                </Box>
                {a.resolution_note && (
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    {a.resolution_note}
                  </Typography>
                )}
              </Alert>
            ))}
          </Stack>
        )}
      </Box>

      <AssignAlertDialog open={assignTarget !== null} alertId={assignTarget} onClose={() => setAssignTarget(null)} onAssigned={load} />
      <ResolveAlertDialog open={resolveTarget !== null} alertId={resolveTarget} onClose={() => setResolveTarget(null)} onResolved={load} />
      <AlertSubscriptionsDialog open={subscriptionsOpen} onClose={() => setSubscriptionsOpen(false)} />
    </Box>
  );
};
