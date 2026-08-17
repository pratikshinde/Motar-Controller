import React, { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Stack, Box } from '@mui/material';
import { createBatch } from '../api/batches';
import { useToast } from '../context/ToastContext';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export const CreateBatchDialog: React.FC<Props> = ({ open, onClose, onCreated }) => {
  const { showToast } = useToast();
  const [batchCode, setBatchCode] = useState('');
  const [model, setModel] = useState('');
  const [hwRev, setHwRev] = useState('');
  const [quantity, setQuantity] = useState('');
  const [manufactureDate, setManufactureDate] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setBatchCode('');
      setModel('');
      setHwRev('');
      setQuantity('');
      setManufactureDate('');
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!batchCode.trim() || !model.trim()) {
      showToast('Batch code and model are required', true);
      return;
    }
    setBusy(true);
    try {
      const result = await createBatch({
        batch_code: batchCode.trim(),
        model: model.trim(),
        hw_rev: hwRev.trim() || undefined,
        quantity: quantity.trim() ? Number(quantity) : undefined,
        manufacture_date: manufactureDate || undefined
      });
      showToast(`Batch ${result.batch.batch_code} created`);
      onCreated();
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Could not create batch', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <form onSubmit={submit}>
        <DialogTitle>Create Manufacturing Batch</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Batch code" placeholder="e.g. BATCH-2026-08-A" value={batchCode} onChange={e => setBatchCode(e.target.value)} required fullWidth autoFocus />
            <TextField label="Model" placeholder="e.g. AgriPump AP-15HP" value={model} onChange={e => setModel(e.target.value)} required fullWidth />
            <Box sx={{ display: 'flex', gap: 1.5 }}>
              <TextField label="HW revision" value={hwRev} onChange={e => setHwRev(e.target.value)} fullWidth />
              <TextField label="Declared quantity" type="number" value={quantity} onChange={e => setQuantity(e.target.value)} fullWidth />
            </Box>
            <TextField
              label="Manufacture date"
              type="date"
              value={manufactureDate}
              onChange={e => setManufactureDate(e.target.value)}
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={busy}>
            Create batch
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};
