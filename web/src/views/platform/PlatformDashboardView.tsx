import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, CircularProgress, Typography } from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import { PieChart } from '@mui/x-charts/PieChart';
import { useTheme } from '@mui/material/styles';
import PlayCircleIcon from '@mui/icons-material/PlayCircleOutlined';
import BusinessIcon from '@mui/icons-material/Business';
import WarehouseIcon from '@mui/icons-material/Warehouse';
import StorefrontIcon from '@mui/icons-material/Storefront';
import SignalCellularAltIcon from '@mui/icons-material/SignalCellularAlt';
import { fetchManufacturersOverview, type ManufacturersOverview } from '../../api/brands';
import { ChartCard, STATUS_COLORS, StatTile, monthName, statusSlices } from '../../components/platform/platformUi';

const REFRESH_MS = 30_000;

/** The platform owner's home: five numbers and three graphs, nothing else. */
export const PlatformDashboardView: React.FC = () => {
  const theme = useTheme();
  const [data, setData] = useState<ManufacturersOverview | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await fetchManufacturersOverview());
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

  if (error && !data) return <Alert severity="error">{error}</Alert>;
  if (!data) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  const t = data.totals;
  const slices = statusSlices(t);
  const names = data.manufacturers.map(m => m.short_name || m.name);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 800, fontSize: '1.5rem' }}>
          Dashboard
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Every manufacturer on the platform, in numbers.
        </Typography>
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(5, 1fr)' } }}>
        <StatTile testId="tile-running" icon={PlayCircleIcon} label="Pumps running" value={t.running} color={STATUS_COLORS.running} />
        <StatTile testId="tile-manufacturers" icon={BusinessIcon} label="Manufacturers" value={t.manufacturers} color="#e0a030" />
        <StatTile testId="tile-distributors" icon={WarehouseIcon} label="Distributors" value={t.distributors} color="#7C9CFF" />
        <StatTile testId="tile-dealers" icon={StorefrontIcon} label="Dealers" value={t.dealers} color="#C58BF2" />
        <StatTile testId="tile-gsm" icon={SignalCellularAltIcon} label="Pumps on GSM" value={t.gsm_pumps} color="#3bb8d9" />
      </Box>

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

        <ChartCard title="Pumps per manufacturer" testId="chart-manufacturers">
          {data.manufacturers.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
              No manufacturers yet.
            </Typography>
          ) : (
            <BarChart
              height={260}
              xAxis={[{ data: names, scaleType: 'band' }]}
              series={[
                { data: data.manufacturers.map(m => m.pumps.total), label: 'Pumps', color: theme.palette.info.main },
                { data: data.manufacturers.map(m => m.pumps.running), label: 'Running', color: STATUS_COLORS.running }
              ]}
            />
          )}
        </ChartCard>
      </Box>

      <ChartCard title="New pumps, last 6 months" testId="chart-monthly">
        <BarChart
          height={240}
          xAxis={[{ data: t.monthly_pumps.map(m => monthName(m.month)), scaleType: 'band' }]}
          series={[{ data: t.monthly_pumps.map(m => m.pumps), label: 'Pumps added', color: theme.palette.primary.main }]}
        />
      </ChartCard>
    </Box>
  );
};
