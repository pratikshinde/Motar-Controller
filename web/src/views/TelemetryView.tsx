import React, { useState, useMemo } from 'react';
import { Box, Typography, TextField, InputAdornment, Button, CircularProgress, Card, IconButton, Tooltip } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import AddIcon from '@mui/icons-material/Add';
import BoltIcon from '@mui/icons-material/Bolt';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import HelpOutlineIcon from '@mui/icons-material/HelpOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTheme } from '@mui/material/styles';
import { usePumps } from '../hooks/usePumps';
import { useCooldowns } from '../hooks/useCooldowns';
import { useAuth } from '../context/AuthContext';
import { PumpCard } from '../components/PumpCard';
import { CommissionDialog } from '../components/CommissionDialog';
import { LiveStatusChip } from '../components/LiveStatusChip';
import { monoFont } from '../theme';
import { effectiveStatus } from '../utils/pumpStatus';
import type { PumpListItem } from '../types';

export const TelemetryView: React.FC = () => {
  const theme = useTheme();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'RUNNING' | 'FAULT' | 'STOPPED' | 'OFFLINE'>('ALL');
  const { pumps, stats, loading, reload, lastUpdated, wsStatus } = usePumps(search);
  const { remaining, start } = useCooldowns();
  const [commissionOpen, setCommissionOpen] = useState(false);
  const [editingPump, setEditingPump] = useState<PumpListItem | null>(null);

  const isSuperadmin = user?.role === 'superadmin';

  const kpis = [
    { key: 'ALL', label: 'Total Fleet', value: stats?.total ?? 0, icon: BoltIcon, color: theme.palette.primary.main, bg: 'primaryContainer' },
    { key: 'RUNNING', label: 'Running', value: stats?.running ?? 0, icon: CheckCircleIcon, color: theme.palette.secondary.main, bg: 'secondaryContainer' },
    { key: 'FAULT', label: 'Faults', value: stats?.fault ?? 0, icon: ErrorIcon, color: theme.palette.error.main, bg: 'errorContainer' },
    { key: 'STOPPED', label: 'Stopped', value: stats?.stopped ?? 0, icon: PauseCircleIcon, color: theme.palette.text.secondary, bg: 'background.surfaceVariant' },
    { key: 'OFFLINE', label: 'Offline', value: stats?.offline ?? 0, icon: WifiOffIcon, color: theme.palette.warning.main, bg: 'tertiaryContainer' },
    { key: 'NO_DATA', label: 'No Signal', value: stats?.no_data ?? 0, icon: HelpOutlineIcon, color: theme.palette.text.secondary, bg: 'background.surfaceVariant' }
  ];

  // Client-side quick filter
  const filteredPumps = useMemo(() => {
    if (!pumps) return [];
    if (statusFilter === 'ALL') return pumps;
    return pumps.filter(p => effectiveStatus(p) === statusFilter);
  }, [pumps, statusFilter]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 2.5 }}>
      {/* Executive Metric Cards Strip */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(2, 1fr)',
            sm: 'repeat(3, 1fr)',
            md: 'repeat(6, 1fr)'
          },
          gap: 1.5
        }}
      >
        {kpis.map(k => {
          const Icon = k.icon;
          const isFilterActive = statusFilter === k.key;
          return (
            <Card
              key={k.label}
              elevation={isFilterActive ? 2 : 1}
              onClick={() => {
                if (k.key !== 'NO_DATA') {
                  setStatusFilter(k.key as any);
                }
              }}
              sx={{
                p: 1.5,
                cursor: k.key !== 'NO_DATA' ? 'pointer' : 'default',
                borderRadius: 2,
                border: `1px solid ${isFilterActive ? k.color : theme.palette.divider}`,
                bgcolor: isFilterActive ? 'background.paper' : 'background.paper',
                boxShadow: isFilterActive ? `0 0 0 1.5px ${k.color}` : undefined,
                transition: 'all 0.15s ease',
                '&:hover': {
                  borderColor: k.color
                }
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontWeight: 600, fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}
                >
                  {k.label}
                </Typography>
                <Box
                  sx={{
                    width: 22,
                    height: 22,
                    borderRadius: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: k.bg
                  }}
                >
                  <Icon sx={{ color: k.color, fontSize: 14 }} />
                </Box>
              </Box>
              <Typography
                variant="h4"
                sx={{
                  fontFamily: monoFont,
                  fontWeight: 700,
                  fontSize: '1.35rem',
                  color: isFilterActive ? k.color : 'text.primary',
                  lineHeight: 1
                }}
              >
                {k.value}
              </Typography>
            </Card>
          );
        })}
      </Box>

      {/* Control & Search Toolbar */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1.5,
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1, minWidth: 260, maxWidth: 540 }}>
          <TextField
            fullWidth
            placeholder="Search pumps by name, Thing ID, or GPS location…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            size="small"
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                  </InputAdornment>
                ),
                endAdornment: search ? (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setSearch('')}>
                      <ClearIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </InputAdornment>
                ) : null
              }
            }}
          />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <LiveStatusChip status={wsStatus} lastUpdated={lastUpdated} />
          <Tooltip title="Refresh telemetry">
            <IconButton size="small" onClick={reload} sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: 1.5, p: 0.75 }}>
              <RefreshIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          {isSuperadmin && (
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => {
                setEditingPump(null);
                setCommissionOpen(true);
              }}
              sx={{ height: 36, px: 2 }}
            >
              Commission Pump
            </Button>
          )}
        </Box>
      </Box>

      {/* Pump Grid Content */}
      {loading && (!pumps || pumps.length === 0) ? (
        <Box sx={{ display: 'grid', placeItems: 'center', flex: 1, py: 8 }}>
          <CircularProgress size={36} />
        </Box>
      ) : filteredPumps.length === 0 ? (
        <Card
          elevation={0}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            py: 8,
            px: 3,
            border: `1px dashed ${theme.palette.divider}`,
            bgcolor: 'transparent',
            textAlign: 'center'
          }}
        >
          <Box
            sx={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              bgcolor: 'background.surfaceVariant',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              mb: 1.5
            }}
          >
            <BoltIcon sx={{ color: 'text.secondary', fontSize: 24 }} />
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
            No pumps found
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 380, mb: 2 }}>
            {search || statusFilter !== 'ALL'
              ? 'No devices matched your active search query or status filter. Try clearing the filter.'
              : 'There are no pump devices registered in your account hierarchy.'}
          </Typography>
          {(search || statusFilter !== 'ALL') && (
            <Button
              variant="outlined"
              size="small"
              onClick={() => {
                setSearch('');
                setStatusFilter('ALL');
              }}
            >
              Reset Filters
            </Button>
          )}
        </Card>
      ) : (
        <Box
          sx={{
            flex: 1,
            overflowY: 'auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))',
            gap: 2,
            pr: 0.5,
            alignContent: 'start'
          }}
        >
          {filteredPumps.map(p => (
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

