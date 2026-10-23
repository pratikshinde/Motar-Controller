import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Alert,
  CircularProgress,
  Chip
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useToast } from '../context/ToastContext';
import { apiFetch, messageFrom } from '../api/client';
import { monoFont } from '../theme';

interface BulkImportModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface ParsedRow {
  serial: string;
  model: string;
  hw_rev: string;
  batch_id: string;
  manufacture_date: string;
  supply_type: string;
  hp_rating: string;
}

export const BulkImportModal: React.FC<BulkImportModalProps> = ({ open, onClose, onSuccess }) => {
  const { showToast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.csv')) {
      showToast('Please select a valid .csv file', true);
      return;
    }
    setSelectedFile(file);
    setResult(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;

      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length <= 1) {
        showToast('CSV file appears to be empty', true);
        return;
      }

      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const rows: ParsedRow[] = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim());
        if (cols.length < headers.length) continue;

        const rowMap: Record<string, string> = {};
        headers.forEach((h, idx) => {
          rowMap[h] = cols[idx] || '';
        });

        rows.push({
          serial: rowMap['serial'] || `PUMP-${i}`,
          model: rowMap['model'] || 'PCD-A7672S-V1',
          hw_rev: rowMap['hw_rev'] || '1.0',
          batch_id: rowMap['batch_id'] || 'BATCH-2026',
          manufacture_date: rowMap['manufacture_date'] || '2026-08-15',
          supply_type: rowMap['supply_type'] || '3P',
          hp_rating: rowMap['hp_rating'] || '5.0'
        });
      }

      setParsedRows(rows);
    };
    reader.readAsText(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      // Through apiFetch: it sends the session's token (the app keeps it under its own key, not "token") and renews it
      // when it has expired mid-session.
      const res = await apiFetch('/pumps/bulk-import', { method: 'POST', body: formData });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(messageFrom(errData, 'Import failed'));
      }

      const data = await res.json();
      setResult({
        imported: data.imported_count,
        skipped: data.skipped_count,
        errors: data.errors || []
      });

      showToast(`Successfully imported ${data.imported_count} devices (${data.skipped_count} existing skipped)`);
      onSuccess();
    } catch (err: any) {
      showToast(err.message || 'Bulk import failed', true);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadTemplate = () => {
    window.location.href = '/sample_device_import.csv';
  };

  const handleReset = () => {
    setSelectedFile(null);
    setParsedRows([]);
    setResult(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleReset} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <UploadFileIcon color="primary" />
          <Typography variant="h6">Bulk Device CSV Import (FR-WEB-010)</Typography>
        </Box>
        <Button
          size="small"
          variant="outlined"
          startIcon={<DownloadIcon />}
          onClick={handleDownloadTemplate}
        >
          Download CSV Template
        </Button>
      </DialogTitle>

      <DialogContent dividers>
        {!selectedFile ? (
          <Box
            sx={{
              p: 4,
              border: '2px dashed #444',
              borderRadius: 2,
              textAlign: 'center',
              cursor: 'pointer',
              bgcolor: 'rgba(255,255,255,0.02)',
              '&:hover': { border: '2px dashed #00E676', bgcolor: 'rgba(0, 230, 118, 0.05)' }
            }}
            component="label"
          >
            <input type="file" accept=".csv" hidden onChange={handleFileChange} />
            <UploadFileIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
              Click to upload or drag & drop CSV file
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Upload manufacturing batch list with headers: serial, model, hw_rev, batch_id, manufacture_date, supply_type, hp_rating
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="subtitle2" color="secondary">
                File: {selectedFile.name} ({parsedRows.length} device rows parsed)
              </Typography>
              <Button size="small" color="inherit" onClick={() => { setSelectedFile(null); setParsedRows([]); }}>
                Change File
              </Button>
            </Box>

            {result && (
              <Alert severity="success" icon={<CheckCircleIcon fontSize="inherit" />}>
                Import complete: <strong>{result.imported}</strong> new devices created, <strong>{result.skipped}</strong> already existed.
              </Alert>
            )}

            <Typography variant="overline" color="text.secondary">
              CSV Content Preview ({parsedRows.length} items)
            </Typography>
            <Box sx={{ maxHeight: 240, overflow: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 1 }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'rgba(255,255,255,0.05)' }}>
                    <TableCell>Serial Number</TableCell>
                    <TableCell>Model</TableCell>
                    <TableCell>Supply</TableCell>
                    <TableCell>HP</TableCell>
                    <TableCell>Batch ID</TableCell>
                    <TableCell>Mfg Date</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {parsedRows.slice(0, 10).map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell sx={{ fontFamily: monoFont, fontWeight: 'bold' }}>{row.serial}</TableCell>
                      <TableCell>{row.model}</TableCell>
                      <TableCell><Chip size="small" label={row.supply_type} variant="outlined" /></TableCell>
                      <TableCell>{row.hp_rating} HP</TableCell>
                      <TableCell>{row.batch_id}</TableCell>
                      <TableCell>{row.manufacture_date}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
            {parsedRows.length > 10 && (
              <Typography variant="caption" color="text.secondary">
                ...and {parsedRows.length - 10} more rows
              </Typography>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={handleReset} color="inherit">
          Cancel
        </Button>
        {selectedFile && !result && (
          <Button
            variant="contained"
            color="primary"
            onClick={handleUpload}
            disabled={loading}
            startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <UploadFileIcon />}
          >
            {loading ? 'Importing Devices...' : `Import ${parsedRows.length} Devices`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};
