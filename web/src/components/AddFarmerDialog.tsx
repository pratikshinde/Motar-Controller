import React, { useState } from 'react';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, Stack, TextField, Tooltip, Typography
} from '@mui/material';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import { registerFarmer, type FarmerRegistered } from '../api/farmers';
import { FarmerQrCard } from './FarmerQrCard';
import { BarcodeScanDialog, barcodeScanSupported } from './BarcodeScanDialog';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after a farmer was registered, so the list can refresh. */
  onRegistered: () => void;
}

const tenDigits = (raw: string) => raw.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');

/** The whole registration in one form: the farmer's details, the starter's ID (scanned from the box) and the pump capacity.
 *  Saving creates the farmer, gives them the starter, and shows the one-time QR code to hand over. */
export const AddFarmerDialog: React.FC<Props> = ({ open, onClose, onRegistered }) => {
  const [fullName, setFullName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [starterId, setStarterId] = useState('');
  const [hp, setHp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FarmerRegistered | null>(null);
  const [scanOpen, setScanOpen] = useState(false);

  const reset = () => {
    setFullName('');
    setAddress('');
    setPhone('');
    setStarterId('');
    setHp('');
    setError(null);
    setResult(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    const digits = tenDigits(phone);
    const capacity = Number(hp);
    if (fullName.trim().length < 2) return setError("Enter the farmer's name.");
    if (address.trim().length < 3) return setError("Enter the farmer's address.");
    if (!/^[6-9]\d{9}$/.test(digits)) return setError('Enter a 10-digit mobile number.');
    if (starterId.trim().length < 3) return setError("Scan or type the starter's ID from the box.");
    if (!Number.isFinite(capacity) || capacity <= 0) return setError('Enter the pump capacity in HP.');
    setBusy(true);
    try {
      const res = await registerFarmer({
        full_name: fullName.trim(),
        address: address.trim(),
        phone: digits,
        starter_id: starterId.trim(),
        capacity_hp: capacity
      });
      setResult(res);
      onRegistered();
    } catch (err: any) {
      setError(err?.message || 'Could not register the farmer.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={busy ? undefined : close} fullWidth maxWidth="xs">
        <DialogTitle>{result ? 'Farmer registered' : 'Add farmer'}</DialogTitle>
        {result ? (
          <>
            <DialogContent>
              <FarmerQrCard farmer={result.farmer} pump={result.pump} qr={result.qr} />
            </DialogContent>
            <DialogActions>
              <Button onClick={reset}>Register another</Button>
              <Button variant="contained" onClick={close}>
                Done
              </Button>
            </DialogActions>
          </>
        ) : (
          <form onSubmit={submit}>
            <DialogContent>
              <Stack spacing={2} sx={{ mt: 0.5 }}>
                {error && <Alert severity="error">{error}</Alert>}
                <TextField label="Farmer's name" value={fullName} onChange={e => setFullName(e.target.value)} autoFocus required fullWidth />
                <TextField label="Address" value={address} onChange={e => setAddress(e.target.value)} multiline minRows={2} required fullWidth />
                <TextField
                  label="Mobile number"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="98765 43210"
                  slotProps={{
                    htmlInput: { inputMode: 'tel', maxLength: 16 },
                    input: { startAdornment: <InputAdornment position="start">+91</InputAdornment> }
                  }}
                  required
                  fullWidth
                />
                <TextField
                  label="Starter ID (barcode on the box)"
                  value={starterId}
                  onChange={e => setStarterId(e.target.value.trim())}
                  // A USB barcode scanner types the code and presses Enter: that must not submit the form half filled.
                  onKeyDown={e => {
                    if (e.key === 'Enter') e.preventDefault();
                  }}
                  helperText="Click here and scan the barcode, or type the ID."
                  slotProps={{
                    htmlInput: { 'data-testid': 'starter-id', style: { fontFamily: 'monospace' } },
                    input: {
                      endAdornment: barcodeScanSupported() ? (
                        <InputAdornment position="end">
                          <Tooltip title="Scan with the camera">
                            <IconButton edge="end" onClick={() => setScanOpen(true)} aria-label="Scan with the camera">
                              <QrCodeScannerIcon />
                            </IconButton>
                          </Tooltip>
                        </InputAdornment>
                      ) : undefined
                    }
                  }}
                  required
                  fullWidth
                />
                <TextField
                  label="Pump capacity (HP)"
                  value={hp}
                  onChange={e => setHp(e.target.value)}
                  slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                  required
                  fullWidth
                />
                <Typography variant="caption" color="text.secondary">
                  Saving gives the starter to this farmer and creates a QR code. The farmer scans it once in the app to see the pump.
                </Typography>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" variant="contained" disabled={busy}>
                {busy ? 'Saving…' : 'Register farmer'}
              </Button>
            </DialogActions>
          </form>
        )}
      </Dialog>
      <BarcodeScanDialog
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onScanned={text => {
          setStarterId(text);
          setScanOpen(false);
        }}
      />
    </>
  );
};
