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
      elevation={1}
      onClick={() => navigate(`/devices/${encodeURIComponent(pump.id)}`)}
      sx={{
        cursor: 'pointer',
        borderRadius: 2,
        border: `1px solid ${pump.status === 'FAULT' ? theme.palette.error.main : theme.palette.divider}`,
        transition: 'all 0.15s ease',
        '&:hover': {
          borderColor: pump.status === 'FAULT' ? theme.palette.error.main : 'primary.main',
          boxShadow: theme.palette.mode === 'dark' ? '0 4px 12px rgba(0,0,0,0.4)' : '0 4px 12px rgba(15,23,42,0.06)'
        }
      }}
    >
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {/* Header: Title, Specs, and Status Chip */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="h6" noWrap sx={{ fontWeight: 600, fontSize: '0.9375rem', lineHeight: 1.3 }}>
                {pump.name}
              </Typography>
              <Chip
                size="small"
                label={`${pump.hp_rating} HP`}
                sx={{
                  height: 20,
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  bgcolor: 'background.surfaceVariant',
                  border: `1px solid ${theme.palette.divider}`
                }}
              />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont, fontSize: '0.75rem', display: 'block', mt: 0.25 }}>
              {pump.device_type === 'SOLAR_VFD' ? 'Solar VFD' : pump.supply_type} • {pump.id}
            </Typography>
          </Box>
          <Chip
            size="small"
            label={statusLabel}
            sx={{
              height: 22,
              fontSize: '0.6875rem',
              fontWeight: 700,
              bgcolor: theme.palette.mode === 'dark' ? `${statusColor(status, theme)}26` : `${statusColor(status, theme)}18`,
              color: statusColor(status, theme),
              border: `1px solid ${statusColor(status, theme)}33`,
              fontFamily: monoFont
            }}
          />
        </Box>

        {/* Telemetry Metric Readouts */}
        {pump.device_type === 'SOLAR_VFD' ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
              {[
                ['Frequency', pump.vfd_hz ?? pump.vfd?.hz, 'Hz'],
                ['Power', pump.vfd_kw ?? pump.vfd?.kw, 'kW'],
                ['DC Bus', pump.vfd_v_dc ?? pump.vfd?.v_dc, 'V']
              ].map(([label, value, unit]) => (
                <Box
                  key={label}
                  sx={{
                    bgcolor: 'background.surfaceVariant',
                    border: `1px solid ${theme.palette.divider}`,
                    borderRadius: 1.5,
                    py: 0.75,
                    px: 0.5,
                    textAlign: 'center'
                  }}
                >
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.6875rem', fontWeight: 500 }}>
                    {label}
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: monoFont, fontWeight: 700, fontSize: '0.8125rem' }}>
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
                <Box
                  key={label}
                  sx={{
                    bgcolor: 'background.surfaceVariant',
                    border: `1px solid ${theme.palette.divider}`,
                    borderRadius: 1.5,
                    py: 0.75,
                    px: 0.25,
                    textAlign: 'center'
                  }}
                >
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.625rem', fontWeight: 500 }} noWrap>
                    {label}
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: monoFont, fontWeight: 700, fontSize: '0.75rem' }} noWrap>
                    {unit ? fmt(value as string | number | null, unit as string) : (value ? String(value) : '—')}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
              {[
                ['R-Y', pump.v_ry, 'V'],
                ['Y-B', pump.v_yb, 'V'],
                ['B-R', pump.v_br, 'V']
              ].map(([label, value, unit]) => (
                <Box
                  key={label}
                  sx={{
                    bgcolor: 'background.surfaceVariant',
                    border: `1px solid ${theme.palette.divider}`,
                    borderRadius: 1.5,
                    py: 0.75,
                    px: 0.5,
                    textAlign: 'center'
                  }}
                >
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.6875rem', fontWeight: 500 }}>
                    {label}
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: monoFont, fontWeight: 700, fontSize: '0.8125rem' }}>
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
                <Box
                  key={label}
                  sx={{
                    bgcolor: 'background.surfaceVariant',
                    border: `1px solid ${theme.palette.divider}`,
                    borderRadius: 1.5,
                    py: 0.75,
                    px: 0.5,
                    textAlign: 'center'
                  }}
                >
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.6875rem', fontWeight: 500 }}>
                    {label}
                  </Typography>
                  <Typography variant="body2" sx={{ fontFamily: monoFont, fontWeight: 700, fontSize: '0.8125rem' }}>
                    {fmt(value as string | null, unit as string)}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        )}

        {!pump.telemetry_recorded_at && !pump.v_ry && !pump.i_r && !pump.vfd_hz && !pump.vfd?.hz && (
          <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic', textAlign: 'center', py: 0.5 }}>
            No recent telemetry signal
          </Typography>
        )}

        {/* Subscription Expiry Warning */}
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
              sx={{ alignSelf: 'flex-start', fontWeight: 600, height: 20, fontSize: '0.6875rem' }}
            />
          );
        })()}

        {/* Footer: GPS Location and Control Switch */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, pt: 0.5, borderTop: `1px solid ${theme.palette.divider}` }}>
          <Box
            onClick={e => e.stopPropagation()}
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
              <PlaceIcon sx={{ fontSize: 15, color: 'text.secondary' }} />
              <Typography variant="caption" sx={{ fontFamily: monoFont, fontSize: '0.75rem', color: 'text.secondary' }} noWrap>
                {formatCoords(pump.latitude, pump.longitude)}
              </Typography>
            </Box>
            {isSuperadmin && (
              <Tooltip title="Edit location">
                <IconButton size="small" onClick={() => onEditLocation(pump)} sx={{ p: 0.5 }}>
                  <EditIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            )}
          </Box>

          <Box
            onClick={e => e.stopPropagation()}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              px: 1.25,
              py: 0.5,
              borderRadius: 1.5,
              bgcolor: 'background.surfaceVariant',
              border: `1px solid ${theme.palette.divider}`
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.75rem', color: 'text.primary' }}>
                {t.lblRemoteSwitch}
              </Typography>
              {Boolean(cooldownRemaining) && (
                <Chip
                  size="small"
                  label={`⏳ ${cooldownRemaining}s`}
                  sx={{
                    height: 18,
                    fontSize: '0.625rem',
                    bgcolor: 'tertiaryContainer',
                    color: 'onTertiaryContainer',
                    fontFamily: monoFont,
                    fontWeight: 700
                  }}
                />
              )}
            </Box>
            <Switch
              size="small"
              checked={isOn}
              disabled={busy || Boolean(cooldownRemaining)}
              onChange={e => handleToggle(e.target.checked)}
            />
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
};
