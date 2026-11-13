import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { PieChart } from '@mui/x-charts/PieChart';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PersonAddIcon from '@mui/icons-material/PersonAddAlt';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import InventoryIcon from '@mui/icons-material/Inventory2Outlined';
import PlayCircleIcon from '@mui/icons-material/PlayCircleOutlined';
import StorefrontIcon from '@mui/icons-material/Storefront';
import AgricultureIcon from '@mui/icons-material/Agriculture';
import SignalCellularAltIcon from '@mui/icons-material/SignalCellularAlt';
import ReportProblemIcon from '@mui/icons-material/ReportProblemOutlined';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchTeam, lineageOf, type Team, type TeamMember } from '../../api/team';
import { fetchFarmers, type FarmerRow } from '../../api/farmers';
import { useAuth } from '../../context/AuthContext';
import { AddSubordinateDialog } from '../../components/AddSubordinateDialog';
import { NewPartnerQrDialog } from '../../components/NewPartnerQrDialog';
import { FarmerActions, QR_CHIP } from '../../components/people/FarmerActions';
import { MemberAvatar, MemberChips, PersonCard } from '../../components/people/personUi';
import { ChartCard, STATUS_COLORS, StatTile, statusSlices } from '../../components/platform/platformUi';
import { RoleChip } from '../../components/team/teamStyle';

const tabOf = (role: TeamMember['role']) => role;

/** One distributor's, dealer's or farmer's own dashboard, opened from their card: their numbers, who is under them and what can be done. */
export const PersonDashboardView: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { id = '' } = useParams<{ id: string }>();
  const [team, setTeam] = useState<Team | null>(null);
  const [farmer, setFarmer] = useState<FarmerRow | null>(null);
  const [error, setError] = useState('');
  const [addDealer, setAddDealer] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const t = await fetchTeam();
      setTeam(t);
      const m = t.people.find(p => p.id === id);
      // A farmer's pumps and QR come from the farmers list (the numbers above come from the team).
      setFarmer(m?.role === 'customer' ? (await fetchFarmers()).farmers.find(f => f.id === id) ?? null : null);
      setError('');
    } catch (err: any) {
      setError(err?.message || 'Could not load this page');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const m = team?.people.find(p => p.id === id);

  const back = (
    <Box>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(m ? `/people?tab=${tabOf(m.role)}` : '/people')} data-testid="back-to-people">
        {user?.role === 'dealer' ? 'Farmers' : 'People'}
      </Button>
    </Box>
  );

  if (error && !team) return <Stack spacing={2}>{back}<Alert severity="error">{error}</Alert></Stack>;
  if (!team) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!m) {
    return (
      <Stack spacing={2}>
        {back}
        <Typography color="text.secondary">This person was not found under you.</Typography>
      </Stack>
    );
  }

  const canBuild = user?.role === 'manufacturer' || user?.role === 'distributor';
  const under = team.people.filter(p => p.above.some(a => a.id === m.id));
  const underDealers = under.filter(p => p.role === 'dealer');
  const underFarmers = under.filter(p => p.role === 'customer');
  const slices = statusSlices(m.pumps);
  const success = theme.palette.success.main;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {back}

      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1.5 }}>
        <MemberAvatar m={m} size={64} />
        <Box sx={{ flex: 1, minWidth: 220 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
            <Typography variant="h4" sx={{ fontWeight: 800, fontSize: '1.6rem' }}>
              {m.full_name}
            </Typography>
            <RoleChip role={m.role} />
            <MemberChips m={m} />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {[m.phone_number, m.address].filter(Boolean).join(' · ') || 'No contact details'}
            {m.above.length > 0 ? ` · Under ${lineageOf(m)}` : ''}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {m.role === 'distributor' && (
            <Button startIcon={<AccountTreeIcon />} onClick={() => navigate(`/hierarchy?of=${m.id}`)} data-testid="open-hierarchy">
              Hierarchy
            </Button>
          )}
          {m.role === 'distributor' && canBuild && (
            <Button variant="contained" startIcon={<PersonAddIcon />} onClick={() => setAddDealer(true)} data-testid="add-dealer-under">
              Add dealer
            </Button>
          )}
          {m.role !== 'customer' && canBuild && (
            <Button startIcon={<QrCode2Icon />} onClick={() => setQrOpen(true)} data-testid="new-qr">
              New QR
            </Button>
          )}
          {m.role === 'customer' && farmer && <FarmerActions farmer={farmer} onChanged={load} />}
        </Stack>
      </Stack>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(5, 1fr)' } }}>
        {m.role === 'customer' ? (
          <>
            <StatTile testId="tile-pumps" icon={InventoryIcon} label="Pumps" value={m.pumps.total} color={theme.palette.warning.main} />
            <StatTile testId="tile-running" icon={PlayCircleIcon} label="Running now" value={m.pumps.running} color={STATUS_COLORS.running} />
            <StatTile testId="tile-faults" icon={ReportProblemIcon} label="Faults" value={m.pumps.fault} color={STATUS_COLORS.fault} />
            <StatTile testId="tile-offline" icon={WifiOffIcon} label="Offline" value={m.pumps.offline} color={STATUS_COLORS.offline} />
          </>
        ) : (
          <>
            <StatTile testId="tile-pumps" icon={InventoryIcon} label="Pumps supplied" value={m.pumps.total} color={theme.palette.warning.main} />
            <StatTile testId="tile-running" icon={PlayCircleIcon} label="Running now" value={m.pumps.running} color={STATUS_COLORS.running} />
            {m.role === 'distributor' && <StatTile testId="tile-dealers" icon={StorefrontIcon} label="Dealers" value={m.dealers} color="#C58BF2" />}
            <StatTile testId="tile-farmers" icon={AgricultureIcon} label="Farmers" value={m.farmers} color={success} />
            <StatTile testId="tile-gsm" icon={SignalCellularAltIcon} label="GSM pumps running" value={m.gsm_online} color="#3bb8d9" hint={`of ${m.gsm_pumps} on GSM`} />
          </>
        )}
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: m.role === 'customer' ? '1fr 1fr' : '1fr' } }}>
        <ChartCard title="Pumps by state" testId="chart-status">
          {slices.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 5, textAlign: 'center' }}>
              No pumps yet.
            </Typography>
          ) : (
            <PieChart height={230} series={[{ data: slices, innerRadius: 55, paddingAngle: 2, cornerRadius: 4 }]} />
          )}
        </ChartCard>

        {m.role === 'customer' && farmer && (
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3 }} data-testid="farmer-details">
            <Typography sx={{ fontWeight: 700, mb: 1.5 }}>Pumps and app</Typography>
            <Chip
              size="small"
              label={farmer.status === 'SUSPENDED' ? 'Stopped' : QR_CHIP[farmer.qr.state].label}
              color={farmer.status === 'SUSPENDED' ? 'error' : QR_CHIP[farmer.qr.state].color}
              variant={farmer.qr.state === 'CLAIMED' && farmer.status !== 'SUSPENDED' ? 'filled' : 'outlined'}
              sx={{ mb: 1.5 }}
            />
            {farmer.pumps.length === 0 ? (
              <Typography color="text.secondary">No pump yet.</Typography>
            ) : (
              farmer.pumps.map(p => (
                <Box key={p.id} sx={{ py: 1, borderTop: 1, borderColor: 'divider' }}>
                  <Typography sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{p.id}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {[p.name, p.hp_rating ? `${p.hp_rating} HP` : null, p.status].filter(Boolean).join(' · ')}
                  </Typography>
                </Box>
              ))
            )}
          </Paper>
        )}
      </Box>

      {m.role === 'distributor' && (
        <Section title={`Dealers under ${m.full_name} (${underDealers.length})`} empty="No dealers under this distributor yet." members={underDealers} onOpen={pid => navigate(`/people/${pid}`)} />
      )}
      {m.role !== 'customer' && (
        <Section title={`Farmers under ${m.full_name} (${underFarmers.length})`} empty="No farmers under them yet." members={underFarmers} onOpen={pid => navigate(`/people/${pid}`)} />
      )}

      <AddSubordinateDialog open={addDealer} onClose={() => setAddDealer(false)} onCreated={load} underRole="dealer" lockRole parentId={m.id} parentPath={null} />
      <NewPartnerQrDialog target={qrOpen ? m : null} onClose={() => setQrOpen(false)} onDone={load} />
    </Box>
  );
};

const Section: React.FC<{ title: string; empty: string; members: TeamMember[]; onOpen: (id: string) => void }> = ({ title, empty, members, onOpen }) => (
  <Box>
    <Typography sx={{ fontWeight: 700, mb: 1.5 }}>{title}</Typography>
    {members.length === 0 ? (
      <Typography color="text.secondary">{empty}</Typography>
    ) : (
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(auto-fill, minmax(300px, 1fr))' } }}>
        {members.map(p => (
          <PersonCard key={p.id} m={p} onOpen={() => onOpen(p.id)} />
        ))}
      </Box>
    )}
  </Box>
);

