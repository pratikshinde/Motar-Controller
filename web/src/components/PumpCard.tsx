import React, { useState } from 'react';
import {
  Card, CardContent, Box, Typography, Chip, Switch, IconButton, Tooltip
} from '@mui/material';
import EditIcon from '@mui/icons-material/EditLocationAlt';
import PlaceIcon from '@mui/icons-material/Place';
import { useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { dispatchCommand } from '../api/pumps';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import { useToast } from '../context/ToastContext';
import { monoFont } from '../theme';
import type { PumpListItem } from '../types';

const statusColor = (status: PumpListItem['status'], theme: any) => {
  if (status === 'RUNNING') return theme.palette.secondary.main;
  if (status === 'FAULT') return theme.palette.error.main;
  return theme.palette.text.secondary;
};

// No fabricated fallback — a null reading renders as an em-dash, not a
// plausible-looking number (Web_App_Pending_Items.md W0).
function fmt(value: string | number | null, unit: string) {
  if (value === null || value === undefined || value === '') return '—';
  return `${Number(value).toFixed(1)} ${unit}`;
}

interface Props {
  pump: PumpListItem;
  cooldownRemaining?: number;
  onCooldownStart: (pumpId: string, seconds: number) => void;
  onEditLocation: (pump: PumpListItem) => void;
  onChanged: () => void;
}

export const PumpCard: React.FC<Props> = ({ pump, cooldownRemaining, onCooldownStart, onEditLocation, onChanged }) => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useLocale();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [optimisticOn, setOptimisticOn] = useState<boolean | null>(null);

  const isSuperadmin = user?.role === 'superadmin';
  const isOn = optimisticOn ?? pump.status === 'RUNNING';

  async function handleToggle(checked: boolean) {
    setOptimisticOn(checked);
    setBusy(true);
    const action = checked ? 'START' : 'STOP';
    try {
      const result = await dispatchCommand(pump.id, action);
      if (result.status === 202) {
        showToast(`${action} command sent — pending device acknowledgement (cid ${result.command?.cid.slice(0, 8)}…)`);
        onCooldownStart(pump.id, result.cooldownSec || 45);
      } else if (result.status === 409) {
        setOptimisticOn(!checked);
        showToast(result.message || result.error || 'Command rejected', true);
        onCooldownStart(pump.id, result.remainingSec || 0);
      } else {
        setOptimisticOn(!checked);
        showToast(`Command failed: ${result.error}`, true);
      }
    } catch {
      setOptimisticOn(!checked);
      showToast('Network error dispatching command', true);
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  const statusLabel = pump.status === 'RUNNING' ? t.statusRunning : pump.status === 'FAULT' ? t.statusFault : t.statusStopped;

  return (
    <Card
      elevation={pump.status === 'FAULT' ? 3 : 1}
      onClick={() => navigate(`/devices/${encodeURIComponent(pump.id)}`)}
      sx={{ cursor: 'pointer', ...(pump.status === 'FAULT' ? { borderColor: theme.palette.error.main } : {}) }}
    >
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" noWrap>
              {pump.name} ({pump.hp_rating} HP)
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }}>
              {pump.supply_type} • {pump.id}
            </Typography>
          </Box>
          <Chip
            size="small"
            label={statusLabel}
            sx={{
              bgcolor: theme.palette.mode === 'dark' ? `${statusColor(pump.status, theme)}33` : `${statusColor(pump.status, theme)}1F`,
              color: statusColor(pump.status, theme),
              fontFamily: monoFont,
              fontWeight: 700
            }}
          />
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
          {[
            ['R-Y', pump.v_ry, 'V'],
            ['Y-B', pump.v_yb, 'V'],
            ['B-R', pump.v_br, 'V']
          ].map(([label, value, unit]) => (
            <Box key={label} sx={{ bgcolor: 'background.surfaceVariant', borderRadius: 2, py: 0.75, textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {label}
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: monoFont, fontWeight: 700 }}>
                {fmt(value as string | null, unit as string)}
              </Typography>
            </Box>
          ))}
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
          {[
            ['I·R', pump.i_r, 'A'],
            ['I·Y', pump.i_y, 'A'],
            ['I·B', pump.i_b, 'A']
          ].map(([label, value, unit]) => (
            <Box key={label} sx={{ bgcolor: 'background.surfaceVariant', borderRadius: 2, py: 0.75, textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {label}
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: monoFont, fontWeight: 700 }}>
                {fmt(value as string | null, unit as string)}
              </Typography>
            </Box>
          ))}
        </Box>

        {!pump.telemetry_recorded_at && (
          <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            No telemetry received yet
          </Typography>
        )}

        <Box
          onClick={e => e.stopPropagation()}
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: 'background.surfaceVariant', borderRadius: 2, px: 1.5, py: 0.75 }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
            <PlaceIcon fontSize="inherit" sx={{ color: 'text.secondary' }} />
            <Typography variant="caption" sx={{ fontFamily: monoFont }} noWrap>
              {Number(pump.latitude).toFixed(4)}°N, {Number(pump.longitude).toFixed(4)}°E
            </Typography>
          </Box>
          {isSuperadmin && (
            <Tooltip title="Edit location">
              <IconButton size="small" onClick={() => onEditLocation(pump)}>
                <EditIcon fontSize="inherit" />
              </IconButton>
            </Tooltip>
          )}
        </Box>

        <Box onClick={e => e.stopPropagation()} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
              {t.lblRemoteSwitch}
            </Typography>
            {Boolean(cooldownRemaining) && (
              <Chip size="small" label={`⏳ ${cooldownRemaining}s`} sx={{ bgcolor: `${theme.palette.m3.tertiary}22`, color: theme.palette.m3.tertiary, fontFamily: monoFont }} />
            )}
          </Box>
          <Switch
            checked={isOn}
            disabled={busy || Boolean(cooldownRemaining)}
            onChange={e => handleToggle(e.target.checked)}
          />
        </Box>
      </CardContent>
    </Card>
  );
};
