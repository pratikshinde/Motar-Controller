import React, { useEffect, useState } from 'react';
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Box } from '@mui/material';
import { newPartnerQr, ROLE_NAMES, type PartnerClaim } from '../api/users';
import { PartnerQrCard } from './PartnerQrCard';
import type { RoleTier } from '../types';

interface Props {
  target: { id: string; full_name: string; phone_number?: string | null; role: RoleTier } | null;
  onClose: () => void;
  onDone: () => void;
}

/** A fresh sign-up QR for a distributor or dealer who has not signed in yet, or who lost their password. The old QR stops working. */
export const NewPartnerQrDialog: React.FC<Props> = ({ target, onClose, onDone }) => {
  const [claim, setClaim] = useState<PartnerClaim | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setClaim(null);
    setError('');
    if (!target) return;
    let live = true;
    newPartnerQr(target.id)
      .then(res => {
        if (!live) return;
        setClaim(res.claim);
        onDone();
      })
      .catch((err: any) => live && setError(err.message || 'Could not make a new QR code.'));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id]);

  return (
    <Dialog open={Boolean(target)} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>New QR for {target?.full_name}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error">{error}</Alert>}
        {!error && !claim && (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}
        {claim && target && (
          <>
            <Alert severity="info" sx={{ mb: 2 }}>
              The older QR no longer works. Opening this one lets them choose a new password; any sign-in from before is ended.
            </Alert>
            <PartnerQrCard name={target.full_name} phone={target.phone_number || ''} roleLabel={ROLE_NAMES[target.role]} claim={claim} />
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
};
