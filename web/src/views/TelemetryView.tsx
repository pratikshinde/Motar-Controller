import React, { useState } from 'react';
import { Box, Typography, TextField, InputAdornment, Chip, Button, Stack, CircularProgress } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import BoltIcon from '@mui/icons-material/Bolt';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlined';
import { useTheme } from '@mui/material/styles';
import { usePumps } from '../hooks/usePumps';
import { useCooldowns } from '../hooks/useCooldowns';
import { useAuth } from '../context/AuthContext';
import { PumpCard } from '../components/PumpCard';
import { CommissionDialog } from '../components/CommissionDialog';
import { LiveStatusChip } from '../components/LiveStatusChip';
import type { PumpListItem } from '../types';

export const TelemetryView: React.FC = () => {
  const theme = useTheme();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const { pumps, stats, loading, reload, lastUpdated, wsStatus } = usePumps(search);
  const { remaining, start } = useCooldowns();
  const [commissionOpen, setCommissionOpen] = useState(false);
  const [editingPump, setEditingPump] = useState<PumpListItem | null>(null);

  const isSuperadmin = user?.role === 'superadmin';

  const kpis = [
    { label: 'Total', value: stats?.total ?? 0, icon: BoltIcon, color: theme.palette.primary.main },
    { label: 'Running', value: stats?.running ?? 0, icon: CheckCircleIcon, color: theme.palette.secondary.main },
    { label: 'Faults', value: stats?.fault ?? 0, icon: ErrorIcon, color: theme.palette.error.main },
    { label: 'Stopped', value: stats?.stopped ?? 0, icon: PauseCircleIcon, color: theme.palette.text.secondary },
    // These two add up with the others to Total: every pump is counted once.
    { label: 'Offline', value: stats?.offline ?? 0, icon: WifiOffIcon, color: theme.palette.warning.main },
    { label: 'No data yet', value: stats?.no_data ?? 0, icon: HelpOutlineIcon, color: theme.palette.text.secondary }
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 2 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center', justifyContent: 'space-between' }}>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          {kpis.map(k => (
            <Chip
              key={k.label}
              icon={<k.icon sx={{ color: `${k.color} !important`, fontSize: 16 }} />}
              label={`${k.label}: ${k.value}`}
              sx={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, bgcolor: 'background.surfaceVariant' }}
            />
          ))}
          <LiveStatusChip status={wsStatus} lastUpdated={lastUpdated} />
        </Stack>
        {isSuperadmin && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setEditingPump(null);
              setCommissionOpen(true);
            }}
          >
            Commission Pump
          </Button>
        )}
      </Box>

      <TextField
        placeholder="Search pumps by name, ID, or location…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        size="small"
        slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
      />

      {loading && (!pumps || pumps.length === 0) ? (
        <Box sx={{ display: 'grid', placeItems: 'center', flex: 1 }}>
          <CircularProgress />
        </Box>
      ) : !pumps || pumps.length === 0 ? (
        <Box sx={{ display: 'grid', placeItems: 'center', flex: 1 }}>
          <Typography color="text.secondary">No pumps in scope.</Typography>
        </Box>
      ) : (
        <Box
          sx={{
            flex: 1,
            overflowY: 'auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 2,
            pr: 0.5
          }}
        >
          {pumps.map(p => (
            <PumpCard
              key={p.id}
              pump={p}
              cooldownRemaining={remaining[p.id]}
              onCooldownStart={start}
              onEditLocation={pump => {
                setEditingPump(pump);
                setCommissionOpen(true);
              }}
              onChanged={reload}
            />
          ))}
        </Box>
      )}

      <CommissionDialog
        open={commissionOpen}
        onClose={() => setCommissionOpen(false)}
        onSaved={reload}
        editingPump={editingPump}
      />
    </Box>
  );
};
