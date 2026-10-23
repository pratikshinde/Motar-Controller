import { effectiveStatus, STATUS_LABEL } from '../utils/pumpStatus';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Typography, Chip, IconButton, Tabs, Tab, CircularProgress, Tooltip } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useTheme } from '@mui/material/styles';
import { fetchPumpDetail } from '../api/pumps';
import { useToast } from '../context/ToastContext';
import { useWs } from '../context/WebSocketContext';
import { monoFont } from '../theme';
import { pumpUpdateToTelemetryRow } from '../utils/wsMerge';
import { LiveStatusChip } from '../components/LiveStatusChip';
import { OverviewTab } from '../components/deviceDetail/OverviewTab';
import { TrendsTab } from '../components/deviceDetail/TrendsTab';
import { ConfigurationTab } from '../components/deviceDetail/ConfigurationTab';
import { EventsTab } from '../components/deviceDetail/EventsTab';
import { ScheduleTab } from '../components/deviceDetail/ScheduleTab';
import { OwnershipTab } from '../components/deviceDetail/OwnershipTab';
import { DiagnosticsTab } from '../components/deviceDetail/DiagnosticsTab';
import type { PumpDetail } from '../types';

const TABS = ['overview', 'trends', 'configuration', 'schedule', 'events', 'ownership', 'diagnostics'] as const;
type TabKey = (typeof TABS)[number];

export const DeviceDetailView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const { showToast } = useToast();
  const { subscribe, status: wsStatus } = useWs();

  const [detail, setDetail] = useState<PumpDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('overview');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await fetchPumpDetail(id);
      setDetail(data);
      setLastUpdated(new Date());
    } catch (err: any) {
      showToast(err.message || 'Could not load device', true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Live pump/config updates for exactly this device (FR-WEB-005) — merged
  // into the same `detail` shape load() produces, so Overview/Configuration
  // don't need to know whether a given render came from REST or WS.
  useEffect(() => {
    const unsubPump = subscribe('telemetry', msg => {
      // FastAPI ws_hub shape: { type:"telemetry", pump_id:"...", data:{v_ry,...,status,...} }
      if (msg.pump_id !== id) return;
      const src = msg.data || msg.pump || msg;
      setDetail(prev => {
        if (!prev) return prev;
        // Build a TelemetryRow from the live payload so Overview/TrendsTab tiles update
        const liveTelemetry = src.recorded_at ? {
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
        } : null;
        return {
          ...prev,
          pump: { ...prev.pump, status: src.status ?? prev.pump.status, last_seen_at: src.recorded_at ?? prev.pump.last_seen_at },
          latest_telemetry: liveTelemetry || prev.latest_telemetry
        };
      });
      setLastUpdated(new Date());
    });
    const unsubConfig = subscribe('config', msg => {
      if (msg.pump_id !== id) return;
      setDetail(prev => (prev ? { ...prev, config: msg.config } : prev));
      setLastUpdated(new Date());
    });
    return () => {
      unsubPump();
      unsubConfig();
    };
  }, [id, subscribe]);

  // Memoized on the primitive panel-binding fields, not `detail` itself —
  // DiagnosticsTab resets its local edit state whenever this object's
  // *reference* changes (see its `useEffect(() => setPanelForm(panel), [panel])`),
  // so a fresh literal on every render (e.g. from an unrelated WS tick)
  // would silently wipe in-progress edits even though the save itself
  // succeeded server-side.
  const p = detail?.pump;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const panelBinding = useMemo(
    () => ({
      panel_serial: p?.panel_serial ?? null,
      motor_rating: p?.motor_rating ?? null,
      starter_type: p?.starter_type ?? null,
      pump_make: p?.pump_make ?? null,
      pump_model: p?.pump_model ?? null
    }),
    [p?.panel_serial, p?.motor_rating, p?.starter_type, p?.pump_make, p?.pump_model]
  );

  if (!id) return null;

  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!detail) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <IconButton onClick={() => navigate(-1)}>
          <ArrowBackIcon />
        </IconButton>
        <Typography color="text.secondary">Device not found or not in scope.</Typography>
      </Box>
    );
  }

  const { pump } = detail;
  const shownStatus = effectiveStatus(pump);
  const statusColor =
    shownStatus === 'RUNNING' ? theme.palette.secondary.main
    : shownStatus === 'FAULT' ? theme.palette.error.main
    : shownStatus === 'OFFLINE' ? theme.palette.warning.main
    : theme.palette.text.secondary;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Tooltip title="Back">
          <IconButton onClick={() => navigate(-1)}>
            <ArrowBackIcon />
          </IconButton>
        </Tooltip>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="h4" noWrap>
            {pump.name}{' '}
            <Typography component="span" variant="body2" color="text.secondary" sx={{ fontFamily: monoFont }}>
              ({pump.hp_rating} HP · {pump.id})
            </Typography>
          </Typography>
        </Box>
        <Chip
          label={STATUS_LABEL[shownStatus]}
          sx={{
            bgcolor: theme.palette.mode === 'dark' ? `${statusColor}33` : `${statusColor}1F`,
            color: statusColor,
            fontFamily: monoFont,
            fontWeight: 700
          }}
        />
        <LiveStatusChip status={wsStatus} lastUpdated={lastUpdated} />
      </Box>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tab label="Overview" value="overview" />
        <Tab label="Trends" value="trends" />
        <Tab label="Configuration" value="configuration" />
        <Tab label="Schedule" value="schedule" />
        <Tab label="Events" value="events" />
        <Tab label="Ownership" value="ownership" />
        <Tab label="Diagnostics" value="diagnostics" />
      </Tabs>

      <Box sx={{ flex: 1, overflowY: 'auto', pt: 1 }}>
        {tab === 'overview' && <OverviewTab detail={detail} onRefresh={load} />}
        {tab === 'trends' && <TrendsTab pumpId={id} deviceType={pump.device_type} />}
        {tab === 'configuration' && <ConfigurationTab pumpId={id} initialConfig={detail.config} onSaved={load} />}
        {tab === 'schedule' && <ScheduleTab pumpId={id} initialConfig={detail.config} onSaved={load} />}
        {tab === 'events' && <EventsTab pumpId={id} />}
        {tab === 'ownership' && <OwnershipTab pumpId={id} />}
        {tab === 'diagnostics' && (
          <DiagnosticsTab
            pumpId={id}
            firmwareVersion={pump.firmware_version}
            panel={panelBinding}
            onPanelSaved={load}
            deviceType={pump.device_type}
          />
        )}
      </Box>
    </Box>
  );
};
