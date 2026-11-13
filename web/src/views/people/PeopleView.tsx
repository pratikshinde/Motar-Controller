import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, CircularProgress, InputAdornment, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchTeam, LEVEL_LABEL, type Team, type TeamMember } from '../../api/team';
import { useAuth } from '../../context/AuthContext';
import { AddSubordinateDialog } from '../../components/AddSubordinateDialog';
import { AddFarmerDialog } from '../../components/AddFarmerDialog';
import { NewPartnerQrDialog } from '../../components/NewPartnerQrDialog';
import { PersonCard } from '../../components/people/personUi';

type Level = TeamMember['role'];

/** The levels this login looks after: the admin has all three, a distributor its dealers and farmers, a dealer its farmers. */
export function levelsFor(role: string | undefined): Level[] {
  if (role === 'manufacturer') return ['distributor', 'dealer', 'customer'];
  if (role === 'distributor') return ['dealer', 'customer'];
  if (role === 'dealer') return ['customer'];
  return [];
}

const matches = (m: TeamMember, q: string) =>
  !q.trim() || [m.full_name, m.phone_number || '', m.email || '', ...m.above.map(a => a.name)].join(' ').toLowerCase().includes(q.trim().toLowerCase());

/** The people under you, one tab each (distributors, dealers, farmers), each person a card. Add from the tab; click a card for their own dashboard. */
export const PeopleView: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const levels = levelsFor(user?.role);
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [addPartner, setAddPartner] = useState<'distributor' | 'dealer' | null>(null);
  const [addFarmer, setAddFarmer] = useState(false);
  const [qrTarget, setQrTarget] = useState<TeamMember | null>(null);

  const load = useCallback(async () => {
    try {
      setTeam(await fetchTeam());
      setError('');
    } catch (err: any) {
      setError(err?.message || 'Could not load your people');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const tabParam = params.get('tab');
  const level: Level = (levels.find(l => l === tabParam) ?? levels[0]) as Level;
  const people = useMemo(() => (team ? team.people.filter(p => p.role === level && matches(p, query)) : []), [team, level, query]);
  const count = (l: Level) => (team ? team.people.filter(p => p.role === l).length : 0);

  if (levels.length === 0) return <Typography color="text.secondary">There is nothing to show here for your login.</Typography>;

  const addLabel = level === 'customer' ? 'Add farmer' : level === 'dealer' ? 'Add dealer' : 'Add distributor';
  const onAdd = () => (level === 'customer' ? setAddFarmer(true) : setAddPartner(level));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 800, fontSize: '1.5rem' }}>
          {levels.length === 1 ? LEVEL_LABEL[levels[0]].many : 'People'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {levels.length === 1 ? 'Add a farmer here, and open a card for their own dashboard.' : `${levels.map(l => LEVEL_LABEL[l].many).join(', ')}: add them here, and open a card for their own dashboard.`}
        </Typography>
      </Box>

      {levels.length > 1 && (
      <Tabs
        value={level}
        onChange={(_, v: Level) => {
          setQuery('');
          setParams({ tab: v }, { replace: true });
        }}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        {levels.map(l => (
          <Tab key={l} value={l} label={`${LEVEL_LABEL[l].many} (${count(l)})`} data-testid={`tab-${l}`} />
        ))}
      </Tabs>
      )}

      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1.5 }}>
        <TextField
          size="small"
          placeholder="Search by name or mobile number"
          value={query}
          onChange={e => setQuery(e.target.value)}
          sx={{ flex: '1 1 240px', maxWidth: 420 }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
        />
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" startIcon={<AddIcon />} onClick={onAdd} data-testid="add-person">
          {addLabel}
        </Button>
      </Stack>

      {error && !team && <Alert severity="error">{error}</Alert>}
      {!team && !error && (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {team && people.length === 0 && (
        <Typography color="text.secondary" sx={{ py: 6, textAlign: 'center' }} data-testid="empty">
          {query ? 'Nobody matches that search.' : `No ${LEVEL_LABEL[level].many.toLowerCase()} yet. Use “${addLabel}” to add the first one.`}
        </Typography>
      )}

      {people.length > 0 && (
        <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', md: 'repeat(auto-fill, minmax(320px, 1fr))' } }}>
          {people.map(m => (
            <PersonCard key={m.id} m={m} onOpen={() => navigate(`/people/${m.id}`)} onNewQr={() => setQrTarget(m)} />
          ))}
        </Box>
      )}

      <AddSubordinateDialog open={addPartner !== null} onClose={() => setAddPartner(null)} onCreated={load} underRole={addPartner} lockRole />
      <AddFarmerDialog open={addFarmer} onClose={() => setAddFarmer(false)} onRegistered={load} />
      <NewPartnerQrDialog target={qrTarget} onClose={() => setQrTarget(null)} onDone={load} />
    </Box>
  );
};
