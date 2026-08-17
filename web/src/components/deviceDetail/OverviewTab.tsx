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
  <Box sx={{ bgcolor: 'background.surfaceVariant', borderRadius: 2, py: 1, textAlign: 'center' }}>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
      {label}
    </Typography>
    <Typography variant="body1" sx={{ fontFamily: monoFont, fontWeight: 700 }}>
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
      if (result.status === 202) {
        showToast(`${action} command sent — pending device acknowledgement`);
        start(pump.id, result.cooldownSec || 45);
      } else if (result.status === 409) {
        setOptimisticOn(!checked);
        showToast(result.message || result.error || 'Command rejected', true);
        start(pump.id, result.remainingSec || 0);
      } else {
        setOptimisticOn(!checked);
        showToast(`Command failed: ${result.error}`, true);
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
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
      <Card elevation={1}>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography variant="h6">Live Telemetry</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
            <Tile label="Volt R-Y" value={fmt(latest_telemetry?.v_ry ?? null, 'V')} />
            <Tile label="Volt Y-B" value={fmt(latest_telemetry?.v_yb ?? null, 'V')} />
            <Tile label="Volt B-R" value={fmt(latest_telemetry?.v_br ?? null, 'V')} />
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
            <Tile label="Current R" value={fmt(latest_telemetry?.i_r ?? null, 'A')} />
            <Tile label="Current Y" value={fmt(latest_telemetry?.i_y ?? null, 'A')} />
            <Tile label="Current B" value={fmt(latest_telemetry?.i_b ?? null, 'A')} />
          </Box>
          {!latest_telemetry && (
            <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              No telemetry received yet
            </Typography>
          )}
          {latest_telemetry?.ts_approx && (
            <Chip size="small" label="Approximate timestamp (replayed from offline buffer)" sx={{ alignSelf: 'flex-start' }} />
          )}
          {latest_telemetry?.buffered && (
            <Chip size="small" label="Buffered — reported after reconnect" sx={{ alignSelf: 'flex-start' }} />
          )}

          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                Remote Switch
              </Typography>
              {Boolean(cooldownRemaining) && (
                <Chip
                  size="small"
                  label={`⏳ ${cooldownRemaining}s`}
                  sx={{ bgcolor: `${theme.palette.m3.tertiary}22`, color: theme.palette.m3.tertiary, fontFamily: monoFont }}
                />
              )}
            </Box>
            <Switch checked={isOn} disabled={busy || Boolean(cooldownRemaining)} onChange={e => handleToggle(e.target.checked)} />
          </Box>
        </CardContent>
      </Card>

      <Card elevation={1}>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography variant="h6">Connectivity &amp; State</Typography>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              Lifecycle state
            </Typography>
            {canChangeLifecycle && nextStates.length > 0 ? (
              <>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={lifecycleBusy}
                  endIcon={<ArrowDropDownIcon />}
                  onClick={e => setLifecycleMenuAnchor(e.currentTarget)}
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
              <Chip size="small" label={pump.lifecycle_state} />
            )}
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body2" color="text.secondary">
              Firmware version
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: monoFont }}>
              {pump.firmware_version || '—'}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body2" color="text.secondary">
              Last seen
            </Typography>
            <Chip
              size="small"
              label={timeAgo(pump.last_seen_at)}
              color={isStale ? 'warning' : 'success'}
              variant={isStale ? 'outlined' : 'filled'}
            />
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body2" color="text.secondary">
              Open faults
            </Typography>
            <Chip size="small" label={open_fault_count} color={open_fault_count > 0 ? 'error' : 'success'} />
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body2" color="text.secondary">
              GPS location
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: monoFont }}>
              {Number(pump.latitude).toFixed(4)}°N, {Number(pump.longitude).toFixed(4)}°E
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body2" color="text.secondary">
              Supply type
            </Typography>
            <Typography variant="body2">{pump.supply_type}</Typography>
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic', mt: 1 }}>
            Runtime hours are not yet tracked by any layer of this system — not shown rather than estimated.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
};
