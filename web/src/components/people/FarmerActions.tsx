import React, { useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import BlockIcon from '@mui/icons-material/Block';
import RestoreIcon from '@mui/icons-material/Restore';
import { activateFarmer, deactivateFarmer, newFarmerQr, type FarmerRow, type FarmerRegistered, type QrState } from '../../api/farmers';
import { EditFarmerDialog } from '../EditFarmerDialog';
import { FarmerQrCard } from '../FarmerQrCard';
import { useToast } from '../../context/ToastContext';

export const QR_CHIP: Record<QrState, { label: string; color: 'default' | 'success' | 'warning' | 'error' | 'info' }> = {
  PENDING: { label: 'Waiting to be scanned', color: 'info' },
  CLAIMED: { label: 'Farmer is using the app', color: 'success' },
  EXPIRED: { label: 'QR expired', color: 'warning' },
  REVOKED: { label: 'QR replaced / blocked', color: 'warning' },
  NONE: { label: 'No QR yet', color: 'default' }
};

/** What can be done to one farmer: fix their details, make a new QR (lost phone), stop or restore their app access. */
export const FarmerActions: React.FC<{ farmer: FarmerRow; onChanged: () => void }> = ({ farmer: f, onChanged }) => {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [qrFor, setQrFor] = useState<Pick<FarmerRegistered, 'farmer' | 'qr'> | null>(null);
  const stopped = f.status === 'SUSPENDED';

  async function makeQr() {
    setBusy(true);
    try {
      const res = await newFarmerQr(f.id);
      setQrFor({ farmer: res.farmer, qr: res.qr });
      onChanged();
    } catch (err: any) {
      showToast(err?.message || 'Could not make a new QR.', true);
    } finally {
      setBusy(false);
    }
  }

  async function setAccess(stop: boolean) {
    setBusy(true);
    try {
      await (stop ? deactivateFarmer(f.id) : activateFarmer(f.id));
      showToast(stop ? `${f.full_name} can no longer use the app.` : `${f.full_name} can use the app again.`);
      onChanged();
    } catch (err: any) {
      showToast(err?.message || 'Could not change the farmer.', true);
    } finally {
      setBusy(false);
      setStopping(false);
    }
  }

  return (
    <Box>
      <Box sx={{ display: 'inline-flex', gap: 0.5, flexWrap: 'wrap' }}>
        <Button size="small" startIcon={<EditOutlinedIcon />} disabled={busy} onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button size="small" startIcon={<QrCode2Icon />} disabled={busy || stopped} onClick={makeQr}>
          New QR
        </Button>
        {stopped ? (
          <Button size="small" color="success" startIcon={<RestoreIcon />} disabled={busy} onClick={() => setAccess(false)}>
            Restore
          </Button>
        ) : (
          <Button size="small" color="error" startIcon={<BlockIcon />} disabled={busy} onClick={() => setStopping(true)}>
            Stop
          </Button>
        )}
      </Box>

      <EditFarmerDialog farmer={editing ? f : null} onClose={() => setEditing(false)} onSaved={onChanged} />

      <Dialog open={stopping} onClose={() => setStopping(false)} fullWidth maxWidth="xs">
        <DialogTitle>Stop {f.full_name}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {f.full_name} will be signed out and cannot use the app until you restore them. Their details, their pump and the pump's history are kept.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStopping(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => setAccess(true)}>
            Stop access
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(qrFor)} onClose={() => setQrFor(null)} fullWidth maxWidth="xs">
        <DialogTitle>New QR code</DialogTitle>
        <DialogContent>{qrFor && <FarmerQrCard farmer={qrFor.farmer} pump={f.pumps[0] ?? null} qr={qrFor.qr} />}</DialogContent>
        <DialogActions>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1, pl: 1 }}>
            The earlier QR no longer works.
          </Typography>
          <Button variant="contained" onClick={() => setQrFor(null)}>
            Done
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
