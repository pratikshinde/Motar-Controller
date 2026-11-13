import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import { useNavigate } from 'react-router-dom';
import { BarChart } from '@mui/x-charts/BarChart';
import { PieChart } from '@mui/x-charts/PieChart';
import { useTheme } from '@mui/material/styles';
import PlayCircleIcon from '@mui/icons-material/PlayCircleOutlined';
import InventoryIcon from '@mui/icons-material/Inventory2Outlined';
import WarehouseIcon from '@mui/icons-material/Warehouse';
import StorefrontIcon from '@mui/icons-material/Storefront';
import AgricultureIcon from '@mui/icons-material/Agriculture';
import SignalCellularAltIcon from '@mui/icons-material/SignalCellularAlt';
import { fetchTeam, type Team } from '../../api/team';
import { useAuth } from '../../context/AuthContext';
import { ChartCard, STATUS_COLORS, StatTile, monthName, statusSlices } from '../../components/platform/platformUi';

const REFRESH_MS = 30_000;

/** The home page of an admin, a distributor or a dealer: everything under them in a few numbers and graphs. */
export const ManagerDashboardView: React.FC = () => {
  const theme = useTheme();
  const { user } = useAuth();
  const navigate = useNavigate();
  const role = user?.role;
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setTeam(await fetchTeam());
      setError('');
    } catch (err: any) {
      setError(err?.message || 'Could not load the dashboard');
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  if (error && !team) return <Alert severity="error">{error}</Alert>;
  if (!team) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  const s = team.summary;
  const slices = statusSlices(s.pumps);
  // The bar graph compares the people one level down: the admin's distributors, a distributor's dealers, a dealer's farmers.
  const belowRole = role === 'manufacturer' ? 'distributor' : role === 'distributor' ? 'dealer' : 'customer';
  const belowLabel = belowRole === 'distributor' ? 'distributor' : belowRole === 'dealer' ? 'dealer' : 'farmer';
  const below = team.people.filter(p => p.role === belowRole && p.above.length === 0).sort((a, b) => b.pumps.total - a.pumps.total).slice(0, 8);

  const tiles = [
    <StatTile key="running" testId="tile-running" icon={PlayCircleIcon} label="Pumps running" value={s.pumps.running} color={STATUS_COLORS.running} hint={`of ${s.pumps.total} pumps`} />,
    role === 'manufacturer' && <StatTile key="d" testId="tile-distributors" icon={WarehouseIcon} label="Distributors" value={s.distributors} color="#7C9CFF" />,
    role !== 'dealer' && <StatTile key="dl" testId="tile-dealers" icon={StorefrontIcon} label="Dealers" value={s.dealers} color="#C58BF2" />,
    <StatTile key="f" testId="tile-farmers" icon={AgricultureIcon} label="Farmers" value={s.farmers} color={theme.palette.success.main} />,
    <StatTile key="g" testId="tile-gsm" icon={SignalCellularAltIcon} label="GSM pumps running" value={s.gsm_online} color="#3bb8d9" hint={`of ${s.gsm_pumps} on GSM`} />
  ].filter(Boolean);
  if (role === 'dealer') tiles.unshift(<StatTile key="p" testId="tile-pumps" icon={InventoryIcon} label="Pumps" value={s.pumps.total} color={theme.palette.warning.main} />);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1.5 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800, fontSize: '1.5rem' }}>
            Dashboard
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Everything under you, at a glance.
          </Typography>
        </Box>
        {(role === 'manufacturer' || role === 'distributor') && (
          <Button variant="contained" startIcon={<AccountTreeIcon />} onClick={() => navigate('/hierarchy')} data-testid="open-hierarchy">
            Hierarchy
          </Button>
        )}
      </Stack>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: `repeat(${tiles.length}, 1fr)` } }}>{tiles}</Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' } }}>
        <ChartCard title="Pumps by state" testId="chart-status">
          {slices.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
              No pumps yet.
            </Typography>
          ) : (
            <PieChart height={260} series={[{ data: slices, innerRadius: 60, paddingAngle: 2, cornerRadius: 4 }]} />
          )}
        </ChartCard>

        <ChartCard title={`Pumps per ${belowLabel}`} testId="chart-below">
          {below.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
              No {belowLabel}s yet.
            </Typography>
          ) : (
            <BarChart
              height={260}
              xAxis={[{ data: below.map(p => p.full_name.split(/\s+/)[0]), scaleType: 'band' }]}
              series={[
                { data: below.map(p => p.pumps.total), label: 'Pumps', color: theme.palette.info.main },
                { data: below.map(p => p.pumps.running), label: 'Running', color: STATUS_COLORS.running }
              ]}
            />
          )}
        </ChartCard>
      </Box>

      <ChartCard title="New pumps, last 6 months" testId="chart-monthly">
        <BarChart
          height={240}
          xAxis={[{ data: s.monthly_pumps.map(m => monthName(m.month)), scaleType: 'band' }]}
          series={[{ data: s.monthly_pumps.map(m => m.pumps), label: 'Pumps added', color: theme.palette.primary.main }]}
        />
      </ChartCard>
    </Box>
  );
};
