import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Avatar, Box, Button, Chip, CircularProgress, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { PieChart } from '@mui/x-charts/PieChart';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import InventoryIcon from '@mui/icons-material/Inventory2Outlined';
import WarehouseIcon from '@mui/icons-material/Warehouse';
import StorefrontIcon from '@mui/icons-material/Storefront';
import AgricultureIcon from '@mui/icons-material/Agriculture';
import SignalCellularAltIcon from '@mui/icons-material/SignalCellularAlt';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchManufacturersOverview, type ManufacturerSummary } from '../../api/brands';
import { setViewing } from '../../api/viewing';
import { ChartCard, StatTile, statusSlices } from '../../components/platform/platformUi';
import { initialsOf } from '../ManufacturersView';

const REFRESH_MS = 30_000;

/** One admin's own dashboard, opened from its card: what it has supplied, who is under it, and how many of its pumps are reporting over GSM. */
export const ManufacturerDashboardView: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { key = '' } = useParams<{ key: string }>();
  const [m, setM] = useState<ManufacturerSummary | null | undefined>(undefined);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const all = await fetchManufacturersOverview();
      setM(all.manufacturers.find(x => x.key === key) ?? null);
      setError('');
    } catch (err: any) {
      setError(err?.message || 'Could not load this manufacturer');
    }
  }, [key]);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const back = (
    <Box>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/manufacturers')} data-testid="back-to-list">
        Manufacturers
      </Button>
    </Box>
  );

  if (error && m === undefined) return <Stack spacing={2}>{back}<Alert severity="error">{error}</Alert></Stack>;
  if (m === undefined) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (m === null) {
    return (
      <Stack spacing={2}>
        {back}
        <Typography color="text.secondary">There is no manufacturer called “{key}”.</Typography>
      </Stack>
    );
  }

  const color = m.primary_color || theme.palette.primary.main;
  const on = m.status === 'ACTIVE';
  const slices = statusSlices(m.pumps);

  // The hierarchy is the manufacturer's own account tree, shown read-only: the platform owner looks and cannot add anyone.
  const openHierarchy = () => {
    setViewing({ key: m.key, name: m.name, color: m.primary_color });
    navigate('/hierarchy');
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {back}

      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1.5 }}>
        <Avatar src={m.logo_url || undefined} variant="rounded" sx={{ width: 64, height: 64, fontWeight: 800, fontSize: '1.3rem', bgcolor: alpha(color, 0.18), color, border: `1px solid ${alpha(color, 0.4)}` }}>
          {initialsOf(m.short_name || m.name)}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 220 }}>
          <Typography variant="h4" sx={{ fontWeight: 800, fontSize: '1.6rem' }}>
            {m.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {m.owner ? `${m.owner.name} · ${m.owner.email || m.owner.phone || 'no contact'}` : 'No admin login yet'}
          </Typography>
        </Box>
        <Chip label={on ? 'App on' : 'App off'} color={on ? 'success' : 'default'} variant={on ? 'filled' : 'outlined'} />
        <Button variant="contained" startIcon={<AccountTreeIcon />} onClick={openHierarchy} disabled={!m.owner} data-testid="open-hierarchy">
          Hierarchy
        </Button>
      </Stack>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(5, 1fr)' } }}>
        <StatTile testId="tile-pumps" icon={InventoryIcon} label="Pumps supplied" value={m.pumps.total} color={theme.palette.warning.main} />
        <StatTile testId="tile-distributors" icon={WarehouseIcon} label="Distributors" value={m.distributors} color="#7C9CFF" />
        <StatTile testId="tile-dealers" icon={StorefrontIcon} label="Dealers" value={m.dealers} color="#C58BF2" />
        <StatTile testId="tile-farmers" icon={AgricultureIcon} label="Farmers" value={m.farmers} color={theme.palette.success.main} />
        <StatTile testId="tile-gsm" icon={SignalCellularAltIcon} label="GSM pumps running" value={m.gsm_online} color="#3bb8d9" hint={`of ${m.gsm_pumps} on GSM`} />
      </Box>

      <ChartCard title="Pumps by state" testId="chart-status">
        {slices.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 5, textAlign: 'center' }}>
            No pumps supplied yet.
          </Typography>
        ) : (
          <PieChart height={240} series={[{ data: slices, innerRadius: 55, paddingAngle: 2, cornerRadius: 4 }]} />
        )}
      </ChartCard>
    </Box>
  );
};
