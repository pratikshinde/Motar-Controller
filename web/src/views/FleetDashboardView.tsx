import React, { useState, useEffect, useCallback } from 'react';
import { Box, Card, CardContent, Typography, CircularProgress, Chip, List, ListItemButton, ListItemText } from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import { PieChart } from '@mui/x-charts/PieChart';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@mui/material/styles';
import { fetchFleetDashboard } from '../api/fleet';
import { useWs } from '../context/WebSocketContext';
import { useToast } from '../context/ToastContext';
import { monoFont } from '../theme';
import { categoricalColor } from '../utils/categoricalColor';
import type { FleetDashboard } from '../types';

const LIFECYCLE_ORDER = ['MANUFACTURED', 'ALLOCATED', 'IN_STOCK', 'COMMISSIONED', 'ACTIVE', 'SUSPENDED', 'RMA', 'RETIRED'];

export const FleetDashboardView: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { subscribe } = useWs();
  const { showToast } = useToast();
  const [data, setData] = useState<FleetDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await fetchFleetDashboard();
      setData(d);
    } catch (err: any) {
      showToast(err.message || 'Could not load fleet dashboard', true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A live pump/fault event anywhere in scope can move a fleet-wide
  // aggregate — cheaper to just re-fetch than to try to reconcile every
  // slice locally, and the dashboard isn't updating fast enough for that
  // to matter.
  // FastAPI ws_hub shape: { type:"telemetry"|"fault", pump_id:"...", data:{...} }
  // We only use these messages as a signal to refetch — no fields read directly.
  useEffect(() => {
    const unsubPump = subscribe('telemetry', load);
    const unsubFault = subscribe('fault', load);
    return () => {
      unsubPump();
      unsubFault();
    };
  }, [subscribe, load]);

  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!data) return null;

  const lifecycleCounts = data.lifecycle_counts || [];
  const activeFaults = data.active_faults_by_type || [];
  const topFaulting = data.top_faulting_devices_30d || [];
  const warrantyExpiring = data.warranty_expiring_30d || [];
  const firmwareDist = data.firmware_distribution || [];

  const lifecycleMap = new Map(lifecycleCounts.map(r => [r.lifecycle_state, Number(r.count)]));
  const lifecycleSeries = LIFECYCLE_ORDER.map(s => lifecycleMap.get(s as any) || 0);
  const online = Number(data.connectivity?.online_count || 0);
  const offline = Number(data.connectivity?.offline_count || 0);
  const neverSeen = Number(data.connectivity?.never_seen_count || 0);
  const total = Number(data.summary?.total ?? online + offline + neverSeen);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, height: '100%', overflowY: 'auto' }}>
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '1.25rem' }}>
          Fleet Analytics &amp; Operations Dashboard
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
          Real-time aggregated health metrics, connectivity status, and lifecycle distribution across active fleet devices
        </Typography>
      </Box>

      {/* KPI Summary Strip */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)', md: 'repeat(7, 1fr)' }, gap: 1.5 }}>
        {[
          { label: 'Total Fleet', value: total, color: theme.palette.primary.main, bg: 'primaryContainer' },
          { label: 'Online (10m)', value: online, color: theme.palette.secondary.main, bg: 'secondaryContainer' },
          { label: 'Offline', value: offline, color: theme.palette.text.secondary, bg: 'background.surfaceVariant' },
          { label: 'Never Seen', value: neverSeen, color: theme.palette.text.secondary, bg: 'background.surfaceVariant' },
          { label: 'Open Faults', value: activeFaults.reduce((sum, f) => sum + Number(f.count), 0), color: theme.palette.error.main, bg: 'errorContainer' },
          { label: 'Faults Today', value: data.faults_today_count || 0, color: theme.palette.error.main, bg: 'errorContainer' },
          { label: 'Warranty (30d)', value: warrantyExpiring.length, color: theme.palette.m3.tertiary, bg: 'tertiaryContainer' }
        ].map(k => (
          <Card key={k.label} elevation={1} sx={{ p: 1.5, borderRadius: 2, border: `1px solid ${theme.palette.divider}` }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', mb: 0.75 }}>
              {k.label}
            </Typography>
            <Typography variant="h4" sx={{ fontFamily: monoFont, fontWeight: 700, fontSize: '1.35rem', color: k.color, lineHeight: 1 }}>
              {k.value}
            </Typography>
          </Card>
        ))}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' }, gap: 2 }}>
        <Card elevation={1}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Devices by lifecycle state
            </Typography>
            {lifecycleSeries.every(v => v === 0) ? (
              <Typography color="text.secondary">No devices in scope.</Typography>
            ) : (
              <BarChart
                height={280}
                xAxis={[{ data: LIFECYCLE_ORDER, scaleType: 'band' }]}
                series={[{ data: lifecycleSeries, color: theme.palette.primary.main }]}
              />
            )}
          </CardContent>
        </Card>

        <Card elevation={1}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Active faults by type
            </Typography>
            {activeFaults.length === 0 ? (
              <Typography color="text.secondary">No open faults.</Typography>
            ) : (
              <PieChart
                height={280}
                series={[
                  {
                    data: activeFaults.map((f, i) => ({
                      id: i,
                      value: Number(f.count),
                      // Severity used to be the only thing distinguishing wedges (as color) and there are only 4
                      // of them for up to 11 fault types, so two different faults often looked identical. Color
                      // now distinguishes the type (guaranteed, one hue per row); severity rides along in the label.
                      label: `${f.name || `Code ${f.fault_code}`} (${f.severity || 'MEDIUM'})`,
                      color: categoricalColor(i)
                    })),
                    innerRadius: 40
                  }
                ]}
              />
            )}
          </CardContent>
        </Card>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2 }}>
        <Card elevation={1}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Top faulting devices (30d)
            </Typography>
            {topFaulting.length === 0 ? (
              <Typography color="text.secondary">No faults recorded in the last 30 days.</Typography>
            ) : (
              <List dense>
                {topFaulting.map(d => (
                  <ListItemButton key={d.id} onClick={() => navigate(`/devices/${encodeURIComponent(d.id)}`)}>
                    <ListItemText primary={d.name} secondary={d.id} slotProps={{ secondary: { sx: { fontFamily: monoFont } } }} />
                    <Chip size="small" label={`${d.fault_count} faults`} color="error" variant="outlined" />
                  </ListItemButton>
                ))}
              </List>
            )}
          </CardContent>
        </Card>

        <Card elevation={1}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Firmware version distribution
            </Typography>
            <BarChart
              height={240}
              layout="horizontal"
              yAxis={[{ data: firmwareDist.map(f => f.firmware_version), scaleType: 'band' }]}
              xAxis={[{}]}
              series={[{ data: firmwareDist.map(f => Number(f.count)), color: theme.palette.m3.tertiary }]}
            />
          </CardContent>
        </Card>
      </Box>

      <Card elevation={1}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Warranty expiring within 30 days (FR-WEB-033)
          </Typography>
          {warrantyExpiring.length === 0 ? (
            <Typography color="text.secondary">No devices with warranty expiring soon.</Typography>
          ) : (
            <List dense>
              {warrantyExpiring.map(d => (
                <ListItemButton key={d.id} onClick={() => navigate(`/devices/${encodeURIComponent(d.id)}`)}>
                  <ListItemText primary={d.name} secondary={d.id} slotProps={{ secondary: { sx: { fontFamily: monoFont } } }} />
                  <Chip size="small" label={new Date(d.warranty_end_date).toLocaleDateString()} sx={{ color: theme.palette.m3.tertiary }} variant="outlined" />
                </ListItemButton>
              ))}
            </List>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};
