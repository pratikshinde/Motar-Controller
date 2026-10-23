import React, { useCallback, useEffect, useState } from 'react';
import { Box, Button, Card, CardContent, Chip, CircularProgress, Stack, Tooltip, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useNavigate } from 'react-router-dom';
import { fetchManufacturersOverview, setManufacturerStatus, type ManufacturerSummary, type ManufacturersOverview } from '../api/brands';
import { setViewing } from '../api/viewing';
import { AddManufacturerDialog } from '../components/AddManufacturerDialog';
import { useToast } from '../context/ToastContext';

const REFRESH_MS = 30_000;

const Stat: React.FC<{ label: string; value: number; color?: string }> = ({ label, value, color }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography variant="h5" sx={{ color, lineHeight: 1.2 }}>
      {value}
    </Typography>
    <Typography variant="caption" color="text.secondary">
      {label}
    </Typography>
  </Box>
);

/**
 * The platform owner's main page: every manufacturer on the platform side by side, with a way into each one's own
 * dashboard. What a manufacturer's card counts is exactly what that manufacturer sees on its own dashboard.
 */
export const ManufacturersView: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [data, setData] = useState<ManufacturersOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchManufacturersOverview());
    } catch (err: any) {
      showToast(err.message || 'Could not load the manufacturers', true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // This page is the platform itself: arriving here (even by typing the address) ends any "viewing a manufacturer".
  useEffect(() => {
    setViewing(null);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  function openDashboard(m: ManufacturerSummary) {
    setViewing({ key: m.key, name: m.name, color: m.primary_color });
    navigate('/fleet');
  }

  async function toggleStatus(m: ManufacturerSummary) {
    const suspend = m.status === 'ACTIVE';
    const ok = window.confirm(
      suspend
        ? `Switch off ${m.name}? Its farmers’ app stops working for everyone until you switch it back on.`
        : `Switch ${m.name} back on?`
    );
    if (!ok) return;
    setBusyKey(m.key);
    try {
      await setManufacturerStatus(m.key, suspend ? 'SUSPENDED' : 'ACTIVE');
      showToast(suspend ? `${m.name} switched off` : `${m.name} switched on`);
      await load();
    } catch (err: any) {
      showToast(err.message || 'Could not change the status', true);
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!data) return null;

  const t = data.totals;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%', overflowY: 'auto' }}>
      <Stack direction="row" spacing={2} useFlexGap sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h4">Manufacturers</Typography>
          <Typography variant="body2" color="text.secondary">
            Every pump manufacturer on the platform. Open one to see its own dashboard, exactly as it sees it.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>
          Add manufacturer
        </Button>
      </Stack>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)', xl: 'repeat(7, 1fr)' }, gap: 2 }}>
        {[
          ['Manufacturers', data.manufacturers.length, undefined],
          ['Farmers', t.farmers, undefined],
          ['Pumps', t.total, undefined],
          ['Running', t.running, theme.palette.secondary.main],
          ['Faults', t.fault, theme.palette.error.main],
          ['Offline', t.offline, theme.palette.text.secondary],
          ['Open alerts', t.open_alerts, theme.palette.error.main]
        ].map(([label, value, color]) => (
          <Card key={label as string} elevation={1}>
            <CardContent>
              <Typography variant="caption" color="text.secondary">
                {label as string}
              </Typography>
              <Typography variant="h3" sx={{ color: color as string | undefined }}>
                {value as number}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      {data.manufacturers.length === 0 ? (
        <Card elevation={1}>
          <CardContent>
            <Typography color="text.secondary">No manufacturers yet. Add the first one.</Typography>
          </CardContent>
        </Card>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2 }}>
          {data.manufacturers.map(m => (
            <Card key={m.key} elevation={1} sx={{ borderTop: `4px solid ${m.primary_color || theme.palette.primary.main}` }}>
              <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h6" noWrap>
                      {m.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {m.owner ? `${m.owner.name} · ${m.owner.phone}` : 'No login created yet'}
                    </Typography>
                  </Box>
                  <Chip
                    size="small"
                    label={m.status === 'ACTIVE' ? 'App on' : 'App off'}
                    color={m.status === 'ACTIVE' ? 'success' : 'default'}
                    variant={m.status === 'ACTIVE' ? 'filled' : 'outlined'}
                  />
                </Stack>

                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))', gap: 2 }}>
                  <Stat label="Farmers" value={m.farmers} />
                  <Stat label="Team" value={m.team} />
                  <Stat label="Pumps" value={m.pumps.total} />
                  <Stat label="Running" value={m.pumps.running} color={theme.palette.secondary.main} />
                  <Stat label="Faults" value={m.pumps.fault} color={m.pumps.fault ? theme.palette.error.main : undefined} />
                  <Stat label="Offline" value={m.pumps.offline} />
                  <Stat label="Open alerts" value={m.open_alerts} color={m.open_alerts ? theme.palette.error.main : undefined} />
                </Box>

                <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                  <Button size="small" color="inherit" onClick={() => toggleStatus(m)} disabled={busyKey === m.key}>
                    {m.status === 'ACTIVE' ? 'Switch app off' : 'Switch app on'}
                  </Button>
                  <Tooltip title={m.owner ? '' : 'This manufacturer has no login yet, so there is no dashboard to show.'}>
                    <span>
                      <Button variant="contained" size="small" endIcon={<OpenInNewIcon />} onClick={() => openDashboard(m)} disabled={!m.owner}>
                        Open dashboard
                      </Button>
                    </span>
                  </Tooltip>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      <AddManufacturerDialog open={addOpen} onClose={() => setAddOpen(false)} onCreated={() => load()} />
    </Box>
  );
};
