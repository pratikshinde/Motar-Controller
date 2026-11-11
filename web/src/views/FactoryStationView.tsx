import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Divider, IconButton, InputAdornment, List, ListItem, ListItemIcon, ListItemText,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DownloadIcon from '@mui/icons-material/Download';
import { downloadStarterTemplate, importStarterSheet, lookupStarter, recordStarterTest } from '../api/batches';
import { useToast } from '../context/ToastContext';
import { BarcodeScanDialog, barcodeScanSupported } from '../components/BarcodeScanDialog';
import { monoFont } from '../theme';
import type { StarterSheetResult, StarterStage, StarterStationView } from '../types';

const todayBatch = () => `BATCH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

/** One starter: the details from the uploaded sheet, how far along it is, and the bench test. */
export const StarterCard: React.FC<{
  starter: StarterStationView;
  busy: boolean;
  onTest: (result: 'PASS' | 'FAIL', note: string) => void;
  onNext: () => void;
}> = ({ starter, busy, onTest, onNext }) => {
  const [note, setNote] = useState('');
  const d = starter.details;
  const rows: [string, string][] = [
    ['Capacity', d.hp_rating != null ? `${d.hp_rating} HP` : '—'],
    ['Supply', d.supply_type ?? '—'],
    ['Model', d.model ?? '—'],
    ['Hardware', d.hw_rev ?? '—'],
    ['Manufactured', d.manufacture_date ? new Date(d.manufacture_date).toLocaleDateString() : '—'],
    ['Modem IMEI', starter.imei ?? '—'],
    ['Batch', starter.batch?.batch_code ?? '—']
  ];
  return (
    <Card variant="outlined" data-testid="starter-card">
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="h5" sx={{ fontFamily: monoFont, fontWeight: 700 }} data-testid="starter-id">
            {starter.starter_id}
          </Typography>
          <Button onClick={onNext} variant="outlined" size="small" data-testid="scan-next">
            Scan next
          </Button>
        </Box>
        {starter.batch?.revoked && <Alert severity="warning">This starter's batch has been revoked. It can no longer be claimed.</Alert>}

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 1.5 }}>
          {rows.map(([label, value]) => (
            <Box key={label}>
              <Typography variant="caption" color="text.secondary">
                {label}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: 'break-all' }}>
                {value}
              </Typography>
            </Box>
          ))}
        </Box>
        {d.notes && (
          <Typography variant="body2" color="text.secondary">
            Note on the sheet: {d.notes}
          </Typography>
        )}

        <Divider />
        <Typography variant="subtitle2">Progress</Typography>
        <List dense disablePadding data-testid="starter-stages">
          {starter.stages.map(s => (
            <StageRow key={s.key} stage={s} />
          ))}
        </List>
        {starter.pump && (
          <Typography variant="caption" color="text.secondary">
            Pump {starter.pump.id} · {starter.pump.connectivity === 'ONLINE' ? 'online' : starter.pump.last_seen_at ? `last heard ${new Date(starter.pump.last_seen_at).toLocaleString()}` : 'not heard from yet'}
            {starter.pump.farmer ? ` · registered to ${starter.pump.farmer}` : ''}
          </Typography>
        )}
        {!starter.claim.claimed && (
          <Alert severity="info" variant="outlined">
            Waiting for the first power-up. Power the starter on with mobile signal; this page updates by itself when it has claimed its certificate.
          </Alert>
        )}

        <Divider />
        <Typography variant="subtitle2">Bench test</Typography>
        {starter.test.result && (
          <Typography variant="body2" data-testid="test-recorded">
            Last recorded: <b>{starter.test.result === 'PASS' ? 'Passed' : 'Failed'}</b>
            {starter.test.tested_by ? ` by ${starter.test.tested_by}` : ''}
            {starter.test.tested_at ? ` on ${new Date(starter.test.tested_at).toLocaleString()}` : ''}
            {starter.test.note ? ` — ${starter.test.note}` : ''}
          </Typography>
        )}
        <TextField size="small" label="Note (optional)" value={note} onChange={e => setNote(e.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} />
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="contained" color="success" disabled={busy || !!starter.batch?.revoked} onClick={() => onTest('PASS', note)} data-testid="test-pass">
            Test passed
          </Button>
          <Button variant="outlined" color="error" disabled={busy || !!starter.batch?.revoked} onClick={() => onTest('FAIL', note)} data-testid="test-fail">
            Test failed
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
};

const StageRow: React.FC<{ stage: StarterStage }> = ({ stage }) => (
  <ListItem disableGutters sx={{ py: 0.25 }} data-testid={`stage-${stage.key}`}>
    <ListItemIcon sx={{ minWidth: 32 }}>
      {stage.failed ? <CancelIcon color="error" fontSize="small" /> : stage.done ? <CheckCircleIcon color="success" fontSize="small" /> : <HourglassEmptyIcon color="disabled" fontSize="small" />}
    </ListItemIcon>
    <ListItemText
      primary={stage.failed ? 'Bench test failed' : stage.label}
      slotProps={{ primary: { variant: 'body2', sx: { fontWeight: stage.done ? 600 : 400, color: stage.done || stage.failed ? 'text.primary' : 'text.secondary' } } }}
    />
    <Chip size="small" label={stage.failed ? 'Failed' : stage.done ? 'Done' : 'Waiting'} color={stage.failed ? 'error' : stage.done ? 'success' : 'default'} variant="outlined" />
  </ListItem>
);

export const FactoryStationView: React.FC = () => {
  const { showToast } = useToast();

  // -- upload
  const [batchCode, setBatchCode] = useState(todayBatch());
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<StarterSheetResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setResult(null);
    setUploadError(null);
    try {
      const res = await importStarterSheet(file, batchCode.trim());
      setResult(res);
      if (res.saved) showToast(`${(res.created ?? 0) + (res.updated ?? 0)} starter(s) saved to ${res.batch?.batch_code}`);
    } catch (err: any) {
      setUploadError(err.message || 'The upload failed');
    } finally {
      setUploading(false);
    }
  }

  // -- scan
  const [code, setCode] = useState('');
  const [starter, setStarter] = useState<StarterStationView | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [testing, setTesting] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const find = useCallback(
    async (value: string) => {
      const wanted = value.trim();
      if (!wanted) return;
      setLooking(true);
      setNotFound(null);
      try {
        setStarter(await lookupStarter(wanted));
      } catch (err: any) {
        setStarter(null);
        setNotFound(err.message || `'${wanted}' was not found`);
      } finally {
        setLooking(false);
        setCode('');
      }
    },
    []
  );

  const next = useCallback(() => {
    setStarter(null);
    setNotFound(null);
    setCode('');
    window.setTimeout(() => input.current?.focus(), 0);
  }, []);

  // While a starter is on screen and has not finished claiming, look again every few seconds so the progress updates by itself.
  useEffect(() => {
    if (!starter || (starter.claim.claimed && starter.stages.every(s => s.done || s.key === 'farmer'))) return undefined;
    const t = window.setInterval(() => {
      lookupStarter(starter.starter_id).then(setStarter).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(t);
  }, [starter]);

  async function handleTest(resultValue: 'PASS' | 'FAIL', note: string) {
    if (!starter) return;
    setTesting(true);
    try {
      setStarter(await recordStarterTest(starter.id, resultValue, note.trim()));
      showToast(resultValue === 'PASS' ? 'Test recorded: passed' : 'Test recorded: failed');
    } catch (err: any) {
      showToast(err.message || 'Could not record the test', true);
    } finally {
      setTesting(false);
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 960 }}>
      <Box>
        <Typography variant="h4">Factory Station</Typography>
        <Typography variant="caption" color="text.secondary">
          Upload each batch's Excel sheet, then scan every starter's barcode to see its details, test it and watch it claim its AWS certificate.
        </Typography>
      </Box>

      <Card variant="outlined">
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography variant="h6">1. Upload the batch sheet</Typography>
          <Typography variant="body2" color="text.secondary">
            One row per starter. Required column: <b>Starter ID</b> (the barcode on the box). Optional: IMEI, HP, Supply (3-phase / 1-phase), Model, HW revision,
            Manufacture date, Notes. A sheet with any problem is rejected as a whole, with every problem listed by row.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField size="small" label="Batch code" value={batchCode} onChange={e => setBatchCode(e.target.value)} slotProps={{ htmlInput: { maxLength: 50, 'data-testid': 'batch-code' } }} />
            <Button component="label" variant="outlined" startIcon={<UploadFileIcon />}>
              {file ? file.name : 'Choose Excel or CSV file'}
              <input
                type="file"
                hidden
                accept=".xlsx,.csv"
                data-testid="sheet-file"
                onChange={e => {
                  setFile(e.target.files?.[0] ?? null);
                  setResult(null);
                  setUploadError(null);
                }}
              />
            </Button>
            <Button variant="contained" disabled={!file || !batchCode.trim() || uploading} onClick={handleUpload} data-testid="upload-sheet">
              {uploading ? <CircularProgress size={20} /> : 'Upload'}
            </Button>
            <Button startIcon={<DownloadIcon />} size="small" onClick={() => downloadStarterTemplate().catch(e => showToast(e.message, true))}>
              Download template
            </Button>
          </Box>
          {uploadError && <Alert severity="error">{uploadError}</Alert>}
          {result?.saved && (
            <Alert severity="success" data-testid="upload-ok">
              Saved to batch <b>{result.batch?.batch_code}</b>: {result.created} new, {result.updated} updated, {result.unchanged} unchanged.
            </Alert>
          )}
          {result && !result.saved && (
            <Box data-testid="upload-problems">
              <Alert severity="error" sx={{ mb: 1 }}>
                Nothing was saved. Fix these {result.errors.length} problem(s) in the sheet and upload it again.
              </Alert>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Row</TableCell>
                    <TableCell>Starter ID</TableCell>
                    <TableCell>Problem</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {result.errors.map((e, i) => (
                    <TableRow key={`${e.row}-${i}`}>
                      <TableCell>{e.row}</TableCell>
                      <TableCell sx={{ fontFamily: monoFont }}>{e.starter_id || '—'}</TableCell>
                      <TableCell>{e.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography variant="h6">2. Scan a starter</Typography>
          <TextField
            inputRef={input}
            autoFocus
            fullWidth
            label="Scan the barcode (or type it) and press Enter"
            value={code}
            onChange={e => setCode(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault(); // a barcode scanner types the code and presses Enter
                find(code);
              }
            }}
            disabled={looking}
            slotProps={{
              htmlInput: { 'data-testid': 'scan-input', autoComplete: 'off' },
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    {looking && <CircularProgress size={18} />}
                    {barcodeScanSupported() && (
                      <Tooltip title="Scan with the camera">
                        <IconButton onClick={() => setScanOpen(true)} aria-label="Scan with the camera">
                          <QrCodeScannerIcon />
                        </IconButton>
                      </Tooltip>
                    )}
                  </InputAdornment>
                )
              }
            }}
          />
          {notFound && (
            <Alert severity="error" data-testid="not-found">
              {notFound}
            </Alert>
          )}
          {starter && <StarterCard starter={starter} busy={testing} onTest={handleTest} onNext={next} />}
        </CardContent>
      </Card>

      <BarcodeScanDialog
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onScanned={text => {
          setScanOpen(false);
          find(text);
        }}
      />
    </Box>
  );
};
