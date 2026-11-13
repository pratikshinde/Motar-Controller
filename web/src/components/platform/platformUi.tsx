import React from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { SvgIconComponent } from '@mui/icons-material';
import type { PumpBuckets } from '../../api/brands';

/** One big number with its icon: the building block of the platform owner's dashboards. */
export const StatTile: React.FC<{ icon: SvgIconComponent; label: string; value: number | string; color: string; testId: string; hint?: string }> = ({
  icon: Icon,
  label,
  value,
  color,
  testId,
  hint
}) => (
  <Paper
    variant="outlined"
    data-testid={testId}
    sx={{ p: 2.25, borderRadius: 3, display: 'flex', alignItems: 'center', gap: 2, borderColor: alpha(color, 0.35), bgcolor: alpha(color, 0.06) }}
  >
    <Box sx={{ width: 50, height: 50, borderRadius: 2.5, display: 'grid', placeItems: 'center', bgcolor: alpha(color, 0.18), color, flexShrink: 0 }}>
      <Icon />
    </Box>
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: '1.9rem', fontWeight: 800, lineHeight: 1.05 }}>{value}</Typography>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      )}
    </Box>
  </Paper>
);

/** A titled box for a graph. */
export const ChartCard: React.FC<{ title: string; children: React.ReactNode; testId?: string }> = ({ title, children, testId }) => (
  <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3 }} data-testid={testId}>
    <Typography sx={{ fontWeight: 700, mb: 1.5 }}>{title}</Typography>
    {children}
  </Paper>
);

/** The colours of the pump states, the same everywhere a pump status is drawn. */
export const STATUS_COLORS = { running: '#2e9e5b', stopped: '#e0a030', fault: '#d9534f', offline: '#8a94a6', no_data: '#b9c0cc' };

/** The slices of the pump-status donut (empty states are left out so the legend only names what exists). */
export function statusSlices(p: PumpBuckets) {
  return [
    { id: 'running', label: 'Running', value: p.running, color: STATUS_COLORS.running },
    { id: 'stopped', label: 'Stopped', value: p.stopped, color: STATUS_COLORS.stopped },
    { id: 'fault', label: 'Fault', value: p.fault, color: STATUS_COLORS.fault },
    { id: 'offline', label: 'Offline', value: p.offline, color: STATUS_COLORS.offline },
    { id: 'no_data', label: 'No signal yet', value: p.no_data, color: STATUS_COLORS.no_data }
  ].filter(s => s.value > 0);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-11" -> "Nov". */
export const monthName = (ym: string) => MONTHS[Math.max(0, Math.min(11, Number(ym.slice(5, 7)) - 1))];

export const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
