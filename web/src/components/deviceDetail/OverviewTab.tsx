import { outcomeOf, watchCommand } from '../../api/commands';
import { formatCoords } from '../../utils/pumpStatus';
import React, { useState } from 'react';
import { Box, Card, CardContent, Typography, Chip, Button, Menu, MenuItem } from '@mui/material';
import Switch from '@mui/material/Switch';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import { useTheme } from '@mui/material/styles';
import { dispatchCommand, setLifecycleState } from '../../api/pumps';
import { useCooldowns } from '../../hooks/useCooldowns';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { monoFont } from '../../theme';
import { LIFECYCLE_TRANSITIONS } from '../../types';
import type { PumpDetail } from '../../types';

function fmt(value: string | number | null | undefined, unit: string) {
  if (value === null || value === undefined || value === '') return '—';
  return `${Number(value).toFixed(1)} ${unit}`;
}

function timeAgo(iso: string | null | undefined) {
  if (!iso) return 'never';
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

const Tile: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <Box
    sx={{
      bgcolor: 'background.surfaceVariant',
      border: theme => `1px solid ${theme.palette.divider}`,
      borderRadius: 1.5,
      py: 1,
      px: 0.75,
      textAlign: 'center'
    }}
  >
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.6875rem', fontWeight: 500 }} noWrap>
      {label}
    </Typography>
    <Typography variant="body1" sx={{ fontFamily: monoFont, fontWeight: 700, fontSize: '0.9375rem', mt: 0.25 }} noWrap>
      {value}
    </Typography>
  </Box>
);

export const OverviewTab: React.FC<{ detail: PumpDetail; onRefresh: () => void }> = ({ detail, onRefresh }) => {
  const theme = useTheme();
  const { showToast } = useToast();
  const { user } = useAuth();
  const { remaining, start } = useCooldowns();
  const { pump, latest_telemetry, open_fault_count } = detail;
  const [busy, setBusy] = useState(false);
  const [optimisticOn, setOptimisticOn] = useState<boolean | null>(null);
  const [lifecycleMenuAnchor, setLifecycleMenuAnchor] = useState<HTMLElement | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);

  const canChangeLifecycle = user && ['superadmin', 'manufacturer', 'distributor', 'dealer'].includes(user.role);
  const nextStates = LIFECYCLE_TRANSITIONS[pump.lifecycle_state] || [];

  async function handleLifecycleChange(toState: (typeof nextStates)[number]) {
    setLifecycleMenuAnchor(null);
    setLifecycleBusy(true);
    try {
      await setLifecycleState(pump.id, toState);
      showToast(`Lifecycle state set to ${toState}`);
      onRefresh();
    } catch (err: any) {
      showToast(err.message || 'Transition rejected', true);
    } finally {
      setLifecycleBusy(false);
    }
  }

  const isOn = optimisticOn ?? pump.status === 'RUNNING';
  const cooldownRemaining = remaining[pump.id];

  async function handleToggle(checked: boolean) {
    setOptimisticOn(checked);
    setBusy(true);
    const action = checked ? 'START' : 'STOP';
    try {
      const result = await dispatchCommand(pump.id, action);
      if (result.status === 200 || result.status === 202) {
        showToast(`${action} sent: waiting for the pump to confirm`);
        start(pump.id, result.cooldownSec || 45);
        if (result.command?.cid) {
          watchCommand(pump.id, result.command.cid, cmd => {
            const outcome = outcomeOf(cmd, action);
            if (!outcome) return;
            showToast(outcome.text, outcome.error);
            if (outcome.error) setOptimisticOn(null);
            onRefresh();
          });
        }
      } else if (result.status === 429) {
        setOptimisticOn(!checked);
        showToast(result.detail || result.error || result.message || 'Command cooldown active (45s protection window)', true);
        start(pump.id, 45);
      } else if (result.status === 409) {
        setOptimisticOn(!checked);
        showToast(result.message || result.error || 'Command rejected', true);
        start(pump.id, result.remainingSec || 0);
      } else {
        setOptimisticOn(!checked);
        showToast(result.detail || result.error || `Command failed (HTTP ${result.status})`, true);
      }
    } catch {
      setOptimisticOn(!checked);
      showToast('Network error dispatching command', true);
    } finally {
      setBusy(false);
      onRefresh();
    }
  }

  const isStale = pump.last_seen_at ? Date.now() - new Date(pump.last_seen_at).getTime() > 15 * 60 * 1000 : true;

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.1fr 0.9fr' }, gap: 2 }}>
      {/* Live Telemetry Card */}
      <Card elevation={1} sx={{ borderRadius: 2 }}>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 2.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '0.9375rem' }}>
              Real-Time Electrical Telemetry
            </Typography>
            <Chip
              size="small"
              label={pump.device_type === 'SOLAR_VFD' ? 'Solar VFD Mode' : 'AC 3-Phase Grid'}
              sx={{ height: 22, fontSize: '0.6875rem', fontWeight: 600, bgcolor: 'background.surfaceVariant' }}
            />
          </Box>

          {pump.device_type === 'SOLAR_VFD' ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
                <Tile label="Drive Frequency" value={fmt(latest_telemetry?.vfd?.hz ?? latest_telemetry?.vfd_hz, 'Hz')} />
                <Tile label="Motor Power" value={fmt(latest_telemetry?.vfd?.kw ?? latest_telemetry?.vfd_kw, 'kW')} />
                <Tile label="DC Bus Voltage" value={fmt(latest_telemetry?.vfd?.v_dc ?? latest_telemetry?.vfd_v_dc, 'V')} />
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1 }}>
                <Tile label="Output Current" value={fmt(latest_telemetry?.vfd?.i_out ?? latest_telemetry?.vfd_i_out, 'A')} />
                <Tile label="AC Output Voltage" value={fmt(latest_telemetry?.vfd?.v_ac ?? latest_telemetry?.vfd_v_ac, 'V')} />
                <Tile label="VFD Status" value={(latest_telemetry?.vfd?.status ?? latest_telemetry?.vfd_status) || '—'} />
                <Tile
                  label="VFD Fault Code"
                  value={
                    (latest_telemetry?.vfd?.fault_code ?? latest_telemetry?.vfd_fault_code)
                      ? `#${latest_telemetry?.vfd?.fault_code ?? latest_telemetry?.vfd_fault_code}`
                      : ((latest_telemetry?.vfd?.fault_code ?? latest_telemetry?.vfd_fault_code) === 0 ? 'Clear' : '—')
                  }
                />
              </Box>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
                <Tile label="Phase R-Y" value={fmt(latest_telemetry?.v_ry ?? null, 'V')} />
                <Tile label="Phase Y-B" value={fmt(latest_telemetry?.v_yb ?? null, 'V')} />
                <Tile label="Phase B-R" value={fmt(latest_telemetry?.v_br ?? null, 'V')} />
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
                <Tile label="Current R" value={fmt(latest_telemetry?.i_r ?? null, 'A')} />
                <Tile label="Current Y" value={fmt(latest_telemetry?.i_y ?? null, 'A')} />
                <Tile label="Current B" value={fmt(latest_telemetry?.i_b ?? null, 'A')} />
              </Box>
            </Box>
          )}

          {!latest_telemetry && !pump.v_ry && !pump.vfd_hz && (
            <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic', textAlign: 'center', py: 1 }}>
              No telemetry reading received yet
            </Typography>
          )}

          {latest_telemetry?.ts_approx && (
            <Chip size="small" label="Approximate timestamp (replayed from offline buffer)" sx={{ alignSelf: 'flex-start' }} />
          )}
          {latest_telemetry?.buffered && (
            <Chip size="small" label="Buffered — reported after reconnect" sx={{ alignSelf: 'flex-start' }} />
          )}

          {/* Remote Switch Control Section */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              mt: 1,
              p: 1.5,
              borderRadius: 2,
              bgcolor: 'background.surfaceVariant',
              border: theme => `1px solid ${theme.palette.divider}`
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8125rem' }}>
                Remote Motor Starter
              </Typography>
              {Boolean(cooldownRemaining) && (
                <Chip
                  size="small"
                  label={`⏳ ${cooldownRemaining}s cooldown`}
                  sx={{ bgcolor: 'tertiaryContainer', color: 'onTertiaryContainer', fontFamily: monoFont, fontWeight: 700, height: 22 }}
                />
              )}
            </Box>
            <Switch checked={isOn} disabled={busy || Boolean(cooldownRemaining)} onChange={e => handleToggle(e.target.checked)} />
          </Box>
        </CardContent>
      </Card>

      {/* Connectivity & Operational State Card */}
      <Card elevation={1} sx={{ borderRadius: 2 }}>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, p: 2.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '0.9375rem' }}>
            Connectivity &amp; Hardware Status
          </Typography>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.5, borderBottom: `1px solid ${theme.palette.divider}` }}>
              <Typography variant="body2" color="text.secondary">
                Lifecycle State
              </Typography>
              {canChangeLifecycle && nextStates.length > 0 ? (
                <>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={lifecycleBusy}
                    endIcon={<ArrowDropDownIcon />}
                    onClick={e => setLifecycleMenuAnchor(e.currentTarget)}
                    sx={{ height: 28, fontSize: '0.75rem', fontWeight: 600 }}
                  >
                    {pump.lifecycle_state}
                  </Button>
                  <Menu anchorEl={lifecycleMenuAnchor} open={Boolean(lifecycleMenuAnchor)} onClose={() => setLifecycleMenuAnchor(null)}>
                    {nextStates.map(s => (
                      <MenuItem key={s} onClick={() => handleLifecycleChange(s)}>
                        → {s}
                      </MenuItem>
                    ))}
                  </Menu>
                </>
              ) : (
                <Chip size="small" label={pump.lifecycle_state} sx={{ height: 22, fontSize: '0.6875rem' }} />
              )}
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.5, borderBottom: `1px solid ${theme.palette.divider}` }}>
              <Typography variant="body2" color="text.secondary">
                Firmware Version
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: monoFont, fontWeight: 600 }}>
                {pump.firmware_version || '—'}
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.5, borderBottom: `1px solid ${theme.palette.divider}` }}>
              <Typography variant="body2" color="text.secondary">
                Last Signal Received
              </Typography>
              <Chip
                size="small"
                label={timeAgo(pump.last_seen_at)}
                color={isStale ? 'warning' : 'success'}
                variant={isStale ? 'outlined' : 'filled'}
                sx={{ height: 22, fontSize: '0.6875rem', fontWeight: 600 }}
              />
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.5, borderBottom: `1px solid ${theme.palette.divider}` }}>
              <Typography variant="body2" color="text.secondary">
                Active Fault Incidents
              </Typography>
              <Chip
                size="small"
                label={`${open_fault_count} Open`}
                color={open_fault_count > 0 ? 'error' : 'success'}
                sx={{ height: 22, fontSize: '0.6875rem', fontWeight: 600 }}
              />
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.5, borderBottom: `1px solid ${theme.palette.divider}` }}>
              <Typography variant="body2" color="text.secondary">
                GPS Coordinates
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: monoFont }}>
                {formatCoords(pump.latitude, pump.longitude)}
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.5, borderBottom: `1px solid ${theme.palette.divider}` }}>
              <Typography variant="body2" color="text.secondary">
                Supply / Power Grid
              </Typography>
              <Typography variant="body2">{pump.supply_type}</Typography>
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.5 }}>
              <Typography variant="body2" color="text.secondary">
                Total Cumulative Runtime
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: monoFont, fontWeight: 600 }}>
                {typeof pump.total_runtime_min === 'number'
                  ? `${Math.floor(pump.total_runtime_min / 60)} h ${pump.total_runtime_min % 60} min`
                  : '—'}
              </Typography>
            </Box>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
};
