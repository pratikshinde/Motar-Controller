import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, Paper, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TextField, Typography
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import BlockIcon from '@mui/icons-material/Block';
import RestoreIcon from '@mui/icons-material/Restore';
import { activateFarmer, deactivateFarmer, fetchFarmers, newFarmerQr, type FarmerRow, type QrState, type FarmerRegistered } from '../api/farmers';
import { EditFarmerDialog } from '../components/EditFarmerDialog';
import { FarmerQrCard } from '../components/FarmerQrCard';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';

const QR_CHIP: Record<QrState, { label: string; color: 'default' | 'success' | 'warning' | 'error' | 'info' }> = {
  PENDING: { label: 'Waiting to be scanned', color: 'info' },
  CLAIMED: { label: 'Farmer is using the app', color: 'success' },
  EXPIRED: { label: 'QR expired', color: 'warning' },
  REVOKED: { label: 'QR replaced / blocked', color: 'warning' },
  NONE: { label: 'No QR yet', color: 'default' }
};

/** The Ajanta admin's farmers: who was registered, which starter each has, and whether the farmer scanned the QR yet. */
export const FarmersView: React.FC = () => {
  const { showToast } = useToast();
  // The Ajanta admin registers farmers; the super admin only monitors them.
  const { user } = useAuth();
  const canEdit = user?.role === 'manufacturer';
  const [farmers, setFarmers] = useState<FarmerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [qrFor, setQrFor] = useState<Pick<FarmerRegistered, 'farmer' | 'qr'> & { pump: FarmerRow['pumps'][number] | null } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<FarmerRow | null>(null);
  const [stopping, setStopping] = useState<FarmerRow | null>(null);

  const load = useCallback(async () => {
    try {
      setFarmers((await fetchFarmers()).farmers);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Could not load the farmers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    window.addEventListener('farmers-changed', load);
    return () => window.removeEventListener('farmers-changed', load);
  }, [load]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return farmers;
    return farmers.filter(f => [f.full_name, f.phone_number, f.address || '', ...f.pumps.map(p => p.id)].join(' ').toLowerCase().includes(q));
  }, [farmers, search]);

  async function makeQr(f: FarmerRow) {
    setBusyId(f.id);
    try {
      const res = await newFarmerQr(f.id);
      setQrFor({ farmer: res.farmer, qr: res.qr, pump: f.pumps[0] ?? null });
      load();
    } catch (err: any) {
      showToast(err?.message || 'Could not make a new QR.', true);
    } finally {
      setBusyId(null);
    }
  }

  async function setAccess(f: FarmerRow, stopped: boolean) {
    setBusyId(f.id);
    try {
      await (stopped ? deactivateFarmer(f.id) : activateFarmer(f.id));
      showToast(stopped ? `${f.full_name} can no longer use the app.` : `${f.full_name} can use the app again.`);
      load();
    } catch (err: any) {
      showToast(err?.message || 'Could not change the farmer.', true);
    } finally {
      setBusyId(null);
      setStopping(null);
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="h6" sx={{ fontWeight: 700, flex: 1, minWidth: 160 }}>
          Farmers
        </Typography>
        <TextField
          size="small"
          placeholder="Search name, mobile, starter"
          value={search}
          onChange={e => setSearch(e.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
        />
        {!canEdit && <Chip size="small" variant="outlined" label="Monitoring only" />}
      </Box>

      {error && <Alert severity="error">{error}</Alert>}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      ) : shown.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            {farmers.length === 0 ? (canEdit ? 'No farmers yet. Use "Add farmer" on the Live Telemetry page to register the first one.' : 'No farmers registered yet.') : 'No farmer matches your search.'}
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Farmer</TableCell>
                <TableCell>Mobile</TableCell>
                <TableCell>Pump</TableCell>
                <TableCell>App access</TableCell>
                <TableCell align="right">{canEdit ? 'Actions' : ''}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map(f => {
                const stopped = f.status === 'SUSPENDED';
                const chip = stopped ? { label: 'Stopped', color: 'error' as const } : QR_CHIP[f.qr.state];
                return (
                  <TableRow key={f.id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{f.full_name}</Typography>
                      <Typography variant="caption" color="text.secondary">{f.address}</Typography>
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{f.phone_number}</TableCell>
                    <TableCell>
                      {f.pumps.length === 0 ? '—' : f.pumps.map(p => (
                        <Typography key={p.id} variant="body2" sx={{ fontFamily: 'monospace' }}>
                          {p.id}{p.hp_rating ? ` · ${p.hp_rating} HP` : ''}
                        </Typography>
                      ))}
                    </TableCell>
                    <TableCell><Chip size="small" label={chip.label} color={chip.color} variant={f.qr.state === 'CLAIMED' && !stopped ? 'filled' : 'outlined'} /></TableCell>
                    <TableCell align="right">
                      {canEdit && (
                        <Box sx={{ display: 'inline-flex', gap: 0.5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <Button size="small" startIcon={<EditOutlinedIcon />} disabled={busyId === f.id} onClick={() => setEditing(f)}>
                            Edit
                          </Button>
                          <Button size="small" startIcon={<QrCode2Icon />} disabled={busyId === f.id || stopped} onClick={() => makeQr(f)}>
                            New QR
                          </Button>
                          {stopped ? (
                            <Button size="small" color="success" startIcon={<RestoreIcon />} disabled={busyId === f.id} onClick={() => setAccess(f, false)}>
                              Restore
                            </Button>
                          ) : (
                            <Button size="small" color="error" startIcon={<BlockIcon />} disabled={busyId === f.id} onClick={() => setStopping(f)}>
                              Stop
                            </Button>
                          )}
                        </Box>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <EditFarmerDialog farmer={editing} onClose={() => setEditing(null)} onSaved={load} />

      <Dialog open={Boolean(stopping)} onClose={() => setStopping(null)} fullWidth maxWidth="xs">
        <DialogTitle>Stop {stopping?.full_name}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {stopping?.full_name} will be signed out and cannot use the app until you restore them. Their details, their pump and the pump's
            history are kept.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStopping(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => stopping && setAccess(stopping, true)}>
            Stop access
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(qrFor)} onClose={() => setQrFor(null)} fullWidth maxWidth="xs">
        <DialogTitle>New QR code</DialogTitle>
        <DialogContent>{qrFor && <FarmerQrCard farmer={qrFor.farmer} pump={qrFor.pump} qr={qrFor.qr} />}</DialogContent>
        <DialogActions>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1, pl: 1 }}>
            The earlier QR no longer works.
          </Typography>
          <Button variant="contained" onClick={() => setQrFor(null)}>Done</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
