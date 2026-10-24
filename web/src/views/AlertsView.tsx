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
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1.5 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '1.25rem' }}>
            Alerts &amp; Operational Incidents
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
            Automated fault escalation, offline anomaly detections, and field technician dispatch workflows
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel id="alert-status-label">Status</InputLabel>
            <Select labelId="alert-status-label" label="Status" value={status} onChange={e => setStatus(e.target.value as AlertFilters['status'])}>
              <MenuItem value="open">Open</MenuItem>
              <MenuItem value="acknowledged">Acknowledged</MenuItem>
              <MenuItem value="resolved">Resolved</MenuItem>
              <MenuItem value="">All Statuses</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel id="alert-severity-label">Severity</InputLabel>
            <Select labelId="alert-severity-label" label="Severity" value={severity} onChange={e => setSeverity(e.target.value)}>
              <MenuItem value="">All Severities</MenuItem>
              <MenuItem value="CRITICAL">Critical</MenuItem>
              <MenuItem value="HIGH">High</MenuItem>
              <MenuItem value="MEDIUM">Medium</MenuItem>
              <MenuItem value="LOW">Low</MenuItem>
            </Select>
          </FormControl>
          {canManageSubscriptions && (
            <Button variant="tonal" size="small" onClick={() => setSubscriptionsOpen(true)} sx={{ height: 36 }}>
              Alert Subscriptions
            </Button>
          )}
        </Stack>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', height: '100%' }}>
            <CircularProgress size={36} />
          </Box>
        ) : alerts.length === 0 ? (
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
              No active incidents
            </Typography>
            <Typography variant="body2" color="text.secondary">
              All pump units in scope are operating within nominal electrical and connectivity parameters.
            </Typography>
          </Box>
        ) : (
          <Stack spacing={1.5}>
            {alerts.map(a => {
              const sev = a.severity || 'LOW';
              const sevColor = sev === 'CRITICAL' || sev === 'HIGH' ? '#DC2626' : sev === 'MEDIUM' ? '#D97706' : '#2563EB';
              return (
                <Box
                  key={a.id}
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
                        label={a.severity}
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
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 700,
                          cursor: 'pointer',
                          color: 'primary.main',
                          '&:hover': { textDecoration: 'underline' }
                        }}
                        onClick={() => navigate(`/devices/${encodeURIComponent(a.pump_id)}`)}
                      >
                        {a.pump_name}
                      </Typography>
                      <Chip
                        size="small"
                        label={a.alert_type === 'FAULT' ? a.fault_name || `Fault Code ${a.fault_code}` : 'Device Offline'}
                        sx={{ height: 20, fontSize: '0.6875rem', fontFamily: monoFont, fontWeight: 600 }}
                      />
                      {a.occurrence_count > 1 && (
                        <Chip size="small" label={`×${a.occurrence_count} events`} sx={{ height: 20, fontSize: '0.6875rem' }} />
                      )}
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont, display: 'block' }}>
                      Reported: {new Date(a.last_occurred_at).toLocaleString()}
                      {a.acknowledged_at && ` • Acknowledged by ${a.acknowledged_by_name || 'Staff'}`}
                      {a.assigned_to_name && ` • Assigned to ${a.assigned_to_name}`}
                      {a.resolved_at && ` • Resolved at ${new Date(a.resolved_at).toLocaleTimeString()}`}
                    </Typography>
                    {a.resolution_note && (
                      <Typography variant="body2" sx={{ mt: 0.75, fontStyle: 'italic', color: 'text.secondary', bgcolor: 'background.surfaceVariant', p: 1, borderRadius: 1 }}>
                        Resolution note: {a.resolution_note}
                      </Typography>
                    )}
                  </Box>

                  <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                    {!a.acknowledged_at && (
                      <Button size="small" variant="outlined" onClick={() => handleAck(a.id)} sx={{ height: 30, fontSize: '0.75rem' }}>
                        Acknowledge
                      </Button>
                    )}
                    {!a.resolved_at && (
                      <Button size="small" variant="outlined" onClick={() => setAssignTarget(a.id)} sx={{ height: 30, fontSize: '0.75rem' }}>
                        Assign
                      </Button>
                    )}
                    {!a.resolved_at && (
                      <Button size="small" variant="contained" onClick={() => setResolveTarget(a.id)} sx={{ height: 30, fontSize: '0.75rem' }}>
                        Resolve
                      </Button>
                    )}
                  </Stack>
                </Box>
              );
            })}
          </Stack>
        )}
      </Box>

      <AssignAlertDialog open={assignTarget !== null} alertId={assignTarget} onClose={() => setAssignTarget(null)} onAssigned={load} />
      <ResolveAlertDialog open={resolveTarget !== null} alertId={resolveTarget} onClose={() => setResolveTarget(null)} onResolved={load} />
      <AlertSubscriptionsDialog open={subscriptionsOpen} onClose={() => setSubscriptionsOpen(false)} />
    </Box>
  );
};
