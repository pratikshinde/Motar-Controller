import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, Card, CardContent, Chip, CircularProgress,
  List, ListItemButton, ListItemText, IconButton, Tooltip
} from '@mui/material';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import BlockIcon from '@mui/icons-material/Block';
import RefreshIcon from '@mui/icons-material/Refresh';
import { fetchBatches, fetchBatchDetail, revokeBatch } from '../api/batches';
import { useToast } from '../context/ToastContext';
import { CreateBatchDialog } from '../components/CreateBatchDialog';
import { ImportImeisDialog } from '../components/ImportImeisDialog';
import { monoFont } from '../theme';
import type { DeviceBatch, BatchImei } from '../types';

export const FactoryConsoleView: React.FC = () => {
  const { showToast } = useToast();
  const [batches, setBatches] = useState<DeviceBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ batch: DeviceBatch; imeis: BatchImei[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const loadBatches = useCallback(async () => {
    try {
      const data = await fetchBatches();
      const list = Array.isArray(data) ? data : (data?.batches || (data as any)?.data || []);
      setBatches(Array.isArray(list) ? list : []);
    } catch (err: any) {
      showToast(err.message || 'Could not load batches', true);
      setBatches([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const data = await fetchBatchDetail(id);
      setDetail(data ? { batch: data.batch, imeis: Array.isArray(data.imeis) ? data.imeis : [] } : null);
    } catch (err: any) {
      showToast(err.message || 'Could not load batch detail', true);
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadBatches();
  }, [loadBatches]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  const safeBatches = Array.isArray(batches) ? batches : [];
  const safeImeis = Array.isArray(detail?.imeis) ? detail.imeis : [];

  async function handleRevoke() {
    if (!detail) return;
    if (!window.confirm(`Revoke batch ${detail.batch.batch_code}? Unclaimed IMEIs in it can no longer be claimed. This cannot be undone.`)) return;
    try {
      await revokeBatch(detail.batch.id);
      showToast(`Batch ${detail.batch.batch_code} revoked`);
      loadBatches();
      loadDetail(detail.batch.id);
    } catch (err: any) {
      showToast(err.message || 'Could not revoke batch', true);
    }
  }

  // `minWidth` on every column: `flex` alone has no floor, so a narrow window would shrink IMEIs and
  // timestamps to ellipsized fragments instead of the grid scrolling horizontally.
  const imeiColumns: GridColDef<BatchImei>[] = [
    { field: 'imei', headerName: 'IMEI', flex: 1, minWidth: 150, renderCell: p => <span style={{ fontFamily: monoFont }}>{p.value}</span> },
    { field: 'mcu_uid', headerName: 'MCU UID', flex: 1, minWidth: 150, valueGetter: (_v, row) => row.mcu_uid || '—', renderCell: p => <span style={{ fontFamily: monoFont }}>{p.value}</span> },
    {
      field: 'claimed',
      headerName: 'State',
      flex: 0.7,
      minWidth: 110,
      renderCell: p => <Chip size="small" label={p.value ? 'Claimed' : 'Unclaimed'} color={p.value ? 'success' : 'default'} variant={p.value ? 'filled' : 'outlined'} />
    },
    { field: 'claimed_at', headerName: 'Claimed at', flex: 1, minWidth: 170, valueGetter: (_v, row) => (row.claimed_at ? new Date(row.claimed_at).toLocaleString() : '—') },
    { field: 'pump_id', headerName: 'Pump ID', flex: 1, minWidth: 150, valueGetter: (_v, row) => row.pump_id || '—' }
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h4">Factory Provisioning Console</Typography>
          <Typography variant="caption" color="text.secondary">
            Manufacturing batches &amp; IMEI claim whitelist (FR-WEB-010/011, C-1) — Superadmin only
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
          Create Batch
        </Button>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '360px 1fr' }, gap: 2, flex: 1, minHeight: 0 }}>
        <Card elevation={1} sx={{ overflowY: 'auto' }}>
          {loading ? (
            <Box sx={{ display: 'grid', placeItems: 'center', p: 4 }}>
              <CircularProgress size={28} />
            </Box>
          ) : safeBatches.length === 0 ? (
            <Typography color="text.secondary" sx={{ p: 2 }}>
              No manufacturing batches yet.
            </Typography>
          ) : (
            <List dense disablePadding>
              {safeBatches.map(b => (
                <ListItemButton key={b.id} selected={b.id === selectedId} onClick={() => setSelectedId(b.id)} sx={{ alignItems: 'flex-start', py: 1.25 }}>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Typography variant="body2" component="span" sx={{ fontWeight: 700, fontFamily: monoFont }}>
                          {b.batch_code}
                        </Typography>
                        {b.revoked && <Chip size="small" label="Revoked" color="warning" variant="outlined" />}
                      </Box>
                    }
                    secondary={
                      <Box component="span" sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, mt: 0.5 }}>
                        <Typography variant="caption" color="text.secondary" component="span">
                          {b.model} {b.hw_rev ? `· ${b.hw_rev}` : ''}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" component="span">
                          {b.imported_count ?? 0} imported / {b.quantity} declared · {b.claimed_count ?? 0} claimed
                        </Typography>
                      </Box>
                    }
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </Card>

        <Card elevation={1} sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {!selectedId ? (
            <Box sx={{ display: 'grid', placeItems: 'center', height: '100%' }}>
              <Typography color="text.secondary">Select a batch to view its IMEI whitelist.</Typography>
            </Box>
          ) : detailLoading || !detail ? (
            <Box sx={{ display: 'grid', placeItems: 'center', height: '100%' }}>
              <CircularProgress />
            </Box>
          ) : (
            <>
              <CardContent sx={{ pb: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1 }}>
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="h6" sx={{ fontFamily: monoFont }}>
                        {detail.batch.batch_code}
                      </Typography>
                      {detail.batch.revoked && <Chip size="small" label="Revoked" color="warning" variant="outlined" />}
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      {detail.batch.model} {detail.batch.hw_rev ? `· ${detail.batch.hw_rev}` : ''}
                      {detail.batch.manufacture_date ? ` · manufactured ${new Date(detail.batch.manufacture_date).toLocaleDateString()}` : ''}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {safeImeis.length} imported / {detail.batch.quantity} declared ·{' '}
                      {safeImeis.filter(i => i.claimed).length} claimed
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <Tooltip title="Refresh">
                      <IconButton size="small" onClick={() => loadDetail(detail.batch.id)}>
                        <RefreshIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Button
                      size="small"
                      variant="tonal"
                      startIcon={<UploadFileIcon fontSize="small" />}
                      onClick={() => setImportOpen(true)}
                      disabled={detail.batch.revoked}
                    >
                      Import IMEIs
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color="warning"
                      startIcon={<BlockIcon fontSize="small" />}
                      onClick={handleRevoke}
                      disabled={detail.batch.revoked}
                    >
                      Revoke
                    </Button>
                  </Box>
                </Box>
              </CardContent>
              <Box sx={{ flex: 1, minHeight: 0, px: 2, pb: 2 }}>
                <DataGrid
                  rows={detail.imeis}
                  columns={imeiColumns}
                  density="compact"
                  pageSizeOptions={[10, 25, 50]}
                  initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
                  disableRowSelectionOnClick
                  showToolbar
                  sx={{ border: 'none', height: '100%' }}
                />
              </Box>
            </>
          )}
        </Card>
      </Box>

      <CreateBatchDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={loadBatches} />
      <ImportImeisDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          loadBatches();
          if (selectedId) loadDetail(selectedId);
        }}
        batchId={selectedId}
      />
    </Box>
  );
};
