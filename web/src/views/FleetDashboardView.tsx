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
import type { FleetDashboard } from '../types';

const LIFECYCLE_ORDER = ['MANUFACTURED', 'ALLOCATED', 'IN_STOCK', 'COMMISSIONED', 'ACTIVE', 'SUSPENDED', 'RMA', 'RETIRED'];
const SEVERITY_COLOR: Record<string, string> = { CRITICAL: '#BA1A1A', HIGH: '#E67C00', MEDIUM: '#B8860B', LOW: '#607D8B' };

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
  useEffect(() => {
    const unsubPump = subscribe('pump_update', load);
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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%', overflowY: 'auto' }}>
      <Typography variant="h4">Fleet Dashboard</Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr 1fr', md: '1fr 1fr 1fr 1fr 1fr 1fr' }, gap: 2 }}>
        <Card elevation={1}>
          <CardContent>
            <Typography variant="caption" color="text.secondary">
              Total devices
            </Typography>
            <Typography variant="h3">{online + offline}</Typography>
          </CardContent>
        </Card>
        <Card elevation={1}>
          <CardContent>
            <Typography variant="caption" color="text.secondary">
              Online (last 15m)
            </Typography>
            <Typography variant="h3" sx={{ color: theme.palette.secondary.main }}>
              {online}
            </Typography>
          </CardContent>
        </Card>
        <Card elevation={1}>
          <CardContent>
            <Typography variant="caption" color="text.secondary">
              Offline
            </Typography>
            <Typography variant="h3" sx={{ color: theme.palette.text.secondary }}>
              {offline}
            </Typography>
          </CardContent>
        </Card>
        <Card elevation={1}>
          <CardContent>
            <Typography variant="caption" color="text.secondary">
              Open faults
            </Typography>
            <Typography variant="h3" sx={{ color: theme.palette.error.main }}>
              {activeFaults.reduce((sum, f) => sum + Number(f.count), 0)}
            </Typography>
          </CardContent>
        </Card>
        <Card elevation={1}>
          <CardContent>
            <Typography variant="caption" color="text.secondary">
              Faults today
            </Typography>
            <Typography variant="h3" sx={{ color: theme.palette.error.main }}>
              {data.faults_today_count || 0}
            </Typography>
          </CardContent>
        </Card>
        <Card elevation={1}>
          <CardContent>
            <Typography variant="caption" color="text.secondary">
              Warranty expiring (30d)
            </Typography>
            <Typography variant="h3" sx={{ color: theme.palette.m3.tertiary }}>
              {warrantyExpiring.length}
            </Typography>
          </CardContent>
        </Card>
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
                      label: f.name || `Code ${f.fault_code}`,
                      color: SEVERITY_COLOR[f.severity || ''] || theme.palette.text.secondary
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
