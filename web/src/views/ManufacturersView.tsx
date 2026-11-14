import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Avatar, Box, Button, Card, CardActionArea, Chip, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useNavigate } from 'react-router-dom';
import { fetchManufacturersOverview, setManufacturerStatus, type ManufacturerSummary, type ManufacturersOverview } from '../api/brands';
import { fetchAdminInvites, resendAdminInvite, sendAdminResetCode, type AdminInvite } from '../api/adminInvites';
import { VerifyAdminInviteDialog } from '../components/VerifyAdminInviteDialog';
import { setViewing } from '../api/viewing';
import { AddManufacturerDialog } from '../components/AddManufacturerDialog';
import { useToast } from '../context/ToastContext';
import { formatDate } from '../components/platform/platformUi';

const REFRESH_MS = 30_000;

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]!.toUpperCase())
    .join('') || '?';

const Mini: React.FC<{ label: string; value: number; color?: string }> = ({ label, value, color }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '1.35rem', fontWeight: 800, lineHeight: 1.1, color }}>{value}</Typography>
    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
      {label}
    </Typography>
  </Box>
);

/** One admin as a card: who they are and, at a glance, how big their business on the platform is. Click to open their own dashboard. */
const ManufacturerCard: React.FC<{ m: ManufacturerSummary; busy: boolean; onOpen: () => void; onToggle: () => void; onNewCode: () => void }> = ({ m, busy, onOpen, onToggle, onNewCode }) => {
  const theme = useTheme();
  const color = m.primary_color || theme.palette.primary.main;
  const on = m.status === 'ACTIVE';
  return (
    <Card
      variant="outlined"
      data-testid={`card-${m.key}`}
      sx={{ borderRadius: 3.5, overflow: 'hidden', borderColor: alpha(color, 0.35), opacity: on ? 1 : 0.75, display: 'flex', flexDirection: 'column' }}
    >
      <Box sx={{ height: 6, bgcolor: color }} />
      <CardActionArea onClick={onOpen} sx={{ p: 2.5, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 2.25 }}>
        <Stack direction="row" spacing={1.75} sx={{ alignItems: 'center' }}>
          <Avatar src={m.logo_url || undefined} variant="rounded" sx={{ width: 54, height: 54, fontWeight: 800, fontSize: '1.15rem', bgcolor: alpha(color, 0.18), color, border: `1px solid ${alpha(color, 0.4)}` }}>
            {initialsOf(m.short_name || m.name)}
          </Avatar>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '1.1rem', lineHeight: 1.2 }} noWrap>
              {m.name}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {m.owner ? `${m.owner.name} · ${m.owner.email || m.owner.phone || 'no contact'}` : 'No admin login yet'}
            </Typography>
          </Box>
          <Chip size="small" label={on ? 'App on' : 'App off'} color={on ? 'success' : 'default'} variant={on ? 'filled' : 'outlined'} />
        </Stack>

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, rowGap: 2.25 }}>
          <Mini label="Pumps supplied" value={m.pumps.total} />
          <Mini label="Running now" value={m.pumps.running} color={theme.palette.success.main} />
          <Mini label="GSM online" value={m.gsm_online} color={theme.palette.info.main} />
          <Mini label="Distributors" value={m.distributors} color="#7C9CFF" />
          <Mini label="Dealers" value={m.dealers} color="#C58BF2" />
          <Mini label="Farmers" value={m.farmers} color={theme.palette.success.main} />
        </Box>
      </CardActionArea>
      <Stack direction="row" sx={{ px: 2.5, py: 1, alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${theme.palette.divider}` }}>
        <Typography variant="caption" color="text.secondary">
          {m.joined ? `Added ${formatDate(m.joined)}` : ''}
        </Typography>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          {m.owner?.id && (
            <Button size="small" color="inherit" disabled={busy} onClick={onNewCode} data-testid={`new-code-${m.key}`}>
              Send new code
            </Button>
          )}
          <Button size="small" color="inherit" disabled={busy} onClick={onToggle} data-testid={`toggle-${m.key}`}>
            {on ? 'Switch app off' : 'Switch app on'}
          </Button>
          <Button size="small" endIcon={<ChevronRightIcon />} onClick={onOpen}>
            Open
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
};

/** The platform owner's list of admins (manufacturers), one card each, with a way to register a new one. */
export const ManufacturersView: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [data, setData] = useState<ManufacturersOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [confirming, setConfirming] = useState<AdminInvite | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchManufacturersOverview());
      setInvites((await fetchAdminInvites().catch(() => ({ invites: [] as AdminInvite[] }))).invites);
      setError('');
    } catch (err: any) {
      setError(err?.message || 'Could not load the manufacturers');
    } finally {
      setLoading(false);
    }
  }, []);

  // This page is the platform itself: arriving here (even by typing the address) ends any "viewing a manufacturer's team".
  useEffect(() => {
    if (window.location.pathname.startsWith('/manufacturers')) setViewing(null);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  // Admins who were added and whose email is not confirmed yet (the code was not typed in): they are not manufacturers until it is.
  const waiting = invites.filter(i => i.status === 'WAITING_FOR_CODE' || i.status === 'EXPIRED' || i.status === 'BLOCKED');

  async function toggleStatus(m: ManufacturerSummary) {
    const suspend = m.status === 'ACTIVE';
    const ok = window.confirm(
      suspend ? `Switch off ${m.name}? Its farmers’ app stops working for everyone until you switch it back on.` : `Switch ${m.name} back on?`
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

  async function newCode(m: ManufacturerSummary) {
    const email = m.owner?.email || 'their email';
    if (!window.confirm(`Send a new code to ${email}? They use it on the Admin sign-in, under “First time here”, to choose a new password.`)) return;
    setBusyKey(m.key);
    try {
      await sendAdminResetCode(m.owner!.id!);
      showToast(`A new code was sent to ${email}`);
    } catch (err: any) {
      showToast(err.message || 'Could not send the code', true);
    } finally {
      setBusyKey(null);
    }
  }

  async function sendAgain(invite: AdminInvite) {
    setBusyKey(invite.id);
    try {
      await resendAdminInvite(invite.id);
      showToast(`A new code was sent to ${invite.email}`);
    } catch (err: any) {
      showToast(err.message || 'Could not send the code', true);
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1.5 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800, fontSize: '1.5rem' }}>
            Manufacturers
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Each registered admin has a card. Open one to see its own dashboard.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)} data-testid="register-admin">
          Register admin
        </Button>
      </Stack>

      {error && !data && <Alert severity="error">{error}</Alert>}

      {waiting.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, borderStyle: 'dashed' }} data-testid="waiting-admins">
          <Typography sx={{ fontWeight: 700, mb: 1.25 }}>Waiting to confirm their email ({waiting.length})</Typography>
          <Stack spacing={1}>
            {waiting.map(i => (
              <Box key={i.id} data-testid={`waiting-${i.id}`} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', p: 1.25, borderRadius: 2, bgcolor: theme => alpha(theme.palette.info.main, 0.05) }}>
                <Box sx={{ flex: '1 1 220px', minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600 }} noWrap>
                    {i.full_name} <Typography component="span" variant="body2" color="text.secondary">· {i.company_name || 'no company'}</Typography>
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    A code was sent to {i.email}
                    {i.status === 'EXPIRED' ? ' (expired)' : i.status === 'BLOCKED' ? ' (blocked: too many wrong tries)' : ''}
                  </Typography>
                </Box>
                {i.status === 'WAITING_FOR_CODE' && (
                  <Button size="small" onClick={() => setConfirming(i)} data-testid={`enter-code-${i.id}`}>
                    Enter code
                  </Button>
                )}
                <Button size="small" color="inherit" disabled={busyKey === i.id} onClick={() => sendAgain(i)} data-testid={`send-again-${i.id}`}>
                  Send a new code
                </Button>
              </Box>
            ))}
          </Stack>
        </Paper>
      )}

      {data && data.manufacturers.length === 0 && (
        <Typography color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
          No admins registered yet. Use “Register admin” to add the first one.
        </Typography>
      )}

      {data && data.manufacturers.length > 0 && (
        <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', md: 'repeat(auto-fill, minmax(360px, 1fr))' } }}>
          {data.manufacturers.map(m => (
            <ManufacturerCard
              key={m.key}
              m={m}
              busy={busyKey === m.key}
              onOpen={() => navigate(`/manufacturers/${encodeURIComponent(m.key)}`)}
              onToggle={() => toggleStatus(m)}
              onNewCode={() => newCode(m)}
            />
          ))}
        </Box>
      )}

      <AddManufacturerDialog open={addOpen} onClose={() => setAddOpen(false)} onCreated={() => load()} />
      <VerifyAdminInviteDialog
        invite={confirming}
        onClose={() => setConfirming(null)}
        onDone={() => {
          setConfirming(null);
          load();
        }}
      />
    </Box>
  );
};
