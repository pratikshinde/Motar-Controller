import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Typography, Box, Chip, List, ListItem, ListItemText, Divider, Alert
} from '@mui/material';
import { importBatchImeis } from '../api/batches';
import { useToast } from '../context/ToastContext';
import { monoFont } from '../theme';
import type { BatchImeiImportResult } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  batchId: string | null;
}

// FR-WEB-010/C-1 — paste or CSV-paste of the modem IMEI whitelist. Parsing
// and validation (15-digit format, Luhn check digit, duplicates) happen
// server-side (POST /api/batches/:id/imeis) so there is one authoritative
// pass, not a client copy that could drift from it.
export const ImportImeisDialog: React.FC<Props> = ({ open, onClose, onImported, batchId }) => {
  const { showToast } = useToast();
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BatchImeiImportResult | null>(null);

  useEffect(() => {
    if (open) {
      setRaw('');
      setResult(null);
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!batchId || !raw.trim()) {
      showToast('Paste at least one IMEI', true);
      return;
    }
    setBusy(true);
    try {
      const res = await importBatchImeis(batchId, raw);
      setResult(res);
      if (res.inserted.length > 0) {
        showToast(`${res.inserted.length} IMEI(s) added to whitelist`);
        onImported();
      }
    } catch (err: any) {
      if (err.body?.errors) {
        setResult({ message: err.message, inserted: [], errors: err.body.errors });
      } else {
        showToast(err.message || 'Import failed', true);
      }
    } finally {
      setBusy(false);
    }
  }

  function handleClose() {
    if (result && result.inserted.length > 0) onImported();
    onClose();
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <form onSubmit={submit}>
        <DialogTitle>Import IMEI Whitelist</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Paste one IMEI per line, optionally "imei,mcu_uid". A header row starting with "imei" is skipped
            automatically. Every row is validated server-side (15-digit format, IMEI check digit, and duplicates
            against the entire whitelist) — a row that fails is reported, not silently dropped.
          </Typography>
          <TextField
            label="IMEI list"
            placeholder={'imei,mcu_uid\n490154203237518,MCU-0001A2\n864321041234506'}
            value={raw}
            onChange={e => setRaw(e.target.value)}
            multiline
            minRows={8}
            fullWidth
            slotProps={{ htmlInput: { style: { fontFamily: monoFont, fontSize: '0.85rem' } } }}
          />

          {result && (
            <Box sx={{ mt: 2 }}>
              <Divider sx={{ mb: 2 }} />
              <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                <Chip size="small" color="success" label={`${result.inserted.length} imported`} />
                {result.errors.length > 0 && <Chip size="small" color="error" label={`${result.errors.length} rejected`} />}
              </Box>
              {result.errors.length > 0 && (
                <Alert severity="warning" sx={{ mb: 1 }}>
                  Rejected rows were not added. Fix and re-paste just those lines to retry.
                </Alert>
              )}
              {result.errors.length > 0 && (
                <List dense sx={{ maxHeight: 200, overflowY: 'auto', bgcolor: 'background.surfaceVariant', borderRadius: 1 }}>
                  {result.errors.map((e, i) => (
                    <ListItem key={i}>
                      <ListItemText
                        primary={`Row ${e.row}: ${e.imei || '(blank)'}`}
                        secondary={e.reason}
                        slotProps={{ primary: { sx: { fontFamily: monoFont, fontSize: '0.85rem' } } }}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Close</Button>
          <Button type="submit" variant="contained" disabled={busy}>
            Import
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};
