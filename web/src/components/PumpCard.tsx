import React, { useState } from 'react';
import {
  Card, CardContent, Box, Typography, Chip, Switch, IconButton, Tooltip
} from '@mui/material';
import EditIcon from '@mui/icons-material/EditLocationAlt';
import PlaceIcon from '@mui/icons-material/Place';
import { useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { dispatchCommand } from '../api/pumps';
import { outcomeOf, watchCommand } from '../api/commands';
import { effectiveStatus, formatCoords, STATUS_LABEL, type EffectiveStatus } from '../utils/pumpStatus';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import { useToast } from '../context/ToastContext';
import { monoFont } from '../theme';
import type { PumpListItem } from '../types';

const statusColor = (status: EffectiveStatus, theme: any) => {
  if (status === 'RUNNING') return theme.palette.secondary.main;
  if (status === 'FAULT') return theme.palette.error.main;
  if (status === 'OFFLINE') return theme.palette.warning.main;
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
  const status = effectiveStatus(pump);
  const isOn = optimisticOn ?? status === 'RUNNING';

  async function handleToggle(checked: boolean) {
    setOptimisticOn(checked);
    setBusy(true);
    const action = checked ? 'START' : 'STOP';
    try {
      const result = await dispatchCommand(pump.id, action);
      if (result.status === 200 || result.status === 202) {
        showToast(`${action} sent: waiting for the pump to confirm`);
        onCooldownStart(pump.id, result.cooldownSec || 45);
        // The switch follows what the pump proves, not what was asked: put it back if the command did not land.
        if (result.command?.cid) {
          watchCommand(pump.id, result.command.cid, cmd => {
            const outcome = outcomeOf(cmd, action);
            if (!outcome) return;
            showToast(outcome.text, outcome.error);
            if (outcome.error) setOptimisticOn(null);
            onChanged();
          });
        }
      } else if (result.status === 429) {
        setOptimisticOn(!checked);
        showToast(result.detail || result.error || result.message || 'Command cooldown active (45s protection window)', true);
        onCooldownStart(pump.id, 45);
      } else if (result.status === 409) {
        setOptimisticOn(!checked);
        showToast(result.message || result.error || 'Command rejected', true);
        onCooldownStart(pump.id, result.remainingSec || 0);
      } else {
        setOptimisticOn(!checked);
        showToast(result.detail || result.error || `Command failed (HTTP ${result.status})`, true);
      }
    } catch {
      setOptimisticOn(!checked);
      showToast('Network error dispatching command', true);
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  const statusLabel =
    status === 'RUNNING' ? t.statusRunning : status === 'FAULT' ? t.statusFault : status === 'STOPPED' ? t.statusStopped : STATUS_LABEL[status];

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
              bgcolor: theme.palette.mode === 'dark' ? `${statusColor(status, theme)}33` : `${statusColor(status, theme)}1F`,
              color: statusColor(status, theme),
              fontFamily: monoFont,
              fontWeight: 700
            }}
          />
        </Box>

        {pump.device_type === 'SOLAR_VFD' ? (
          <>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
              {[
                ['Frequency', pump.vfd_hz ?? pump.vfd?.hz, 'Hz'],
                ['Power', pump.vfd_kw ?? pump.vfd?.kw, 'kW'],
                ['DC Bus', pump.vfd_v_dc ?? pump.vfd?.v_dc, 'V']
              ].map(([label, value, unit]) => (
                <Box key={label} sx={{ bgcolor: 'background.surfaceVariant', borderRadius: 2, py: 0.75, textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {label}
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: monoFont, fontWeight: 700 }}>
                    {fmt(value as string | number | null, unit as string)}
                  </Typography>
                </Box>
              ))}
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1 }}>
              {[
                ['Output A', pump.vfd_i_out ?? pump.vfd?.i_out, 'A'],
                ['AC Out', pump.vfd_v_ac ?? pump.vfd?.v_ac, 'V'],
                ['VFD Status', pump.vfd_status ?? pump.vfd?.status, ''],
                ['VFD Fault', (pump.vfd_fault_code ?? pump.vfd?.fault_code) ? `#${pump.vfd_fault_code ?? pump.vfd?.fault_code}` : ((pump.vfd_fault_code ?? pump.vfd?.fault_code) === 0 ? 'None' : null), '']
              ].map(([label, value, unit]) => (
                <Box key={label} sx={{ bgcolor: 'background.surfaceVariant', borderRadius: 2, py: 0.75, textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.7rem' }}>
                    {label}
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: monoFont, fontWeight: 700, fontSize: '0.8rem' }} noWrap>
                    {unit ? fmt(value as string | number | null, unit as string) : (value ? String(value) : '—')}
                  </Typography>
                </Box>
              ))}
            </Box>
          </>
        ) : (
          <>
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
          </>
        )}

        {!pump.telemetry_recorded_at && !pump.v_ry && !pump.i_r && !pump.vfd_hz && !pump.vfd?.hz && (
          <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            No reading
          </Typography>
        )}

        {/* Subscription expiry warning (FR-WEB) */}
        {(() => {
          const exp = (pump as any).subscription_expires_at;
          if (!exp) return null;
          const daysLeft = Math.ceil((new Date(exp).getTime() - Date.now()) / 86400000);
          if (daysLeft > 30) return null;
          return (
            <Chip
              size="small"
              label={daysLeft <= 0 ? 'Subscription expired' : `Subscription expires in ${daysLeft}d`}
              color={daysLeft <= 0 ? 'error' : 'warning'}
              variant="outlined"
              sx={{ alignSelf: 'flex-start', fontWeight: 700 }}
            />
          );
        })()}

        <Box
          onClick={e => e.stopPropagation()}
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: 'background.surfaceVariant', borderRadius: 2, px: 1.5, py: 0.75 }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
            <PlaceIcon fontSize="inherit" sx={{ color: 'text.secondary' }} />
            <Typography variant="caption" sx={{ fontFamily: monoFont }} noWrap>
              {formatCoords(pump.latitude, pump.longitude)}
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
