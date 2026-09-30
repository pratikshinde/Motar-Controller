import React, { useState, useMemo } from 'react';
import { Box, Typography, Chip, IconButton, Tooltip, Card, Button } from '@mui/material';
import { DataGrid, type GridColDef, type GridRowSelectionModel } from '@mui/x-data-grid';
import EditIcon from '@mui/icons-material/EditLocationAlt';
import DeleteIcon from '@mui/icons-material/DeleteOutlineOutlined';
import AddIcon from '@mui/icons-material/Add';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import TuneIcon from '@mui/icons-material/Tune';
import { useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { usePumps } from '../hooks/usePumps';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { deletePump } from '../api/pumps';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { CommissionDialog } from '../components/CommissionDialog';
import { AllocateDialog } from '../components/AllocateDialog';
import { ApplyTemplateDialog } from '../components/ApplyTemplateDialog';
import { BulkImportModal } from '../components/BulkImportModal';
import { effectiveStatus, formatCoords, STATUS_LABEL } from '../utils/pumpStatus';
import { monoFont } from '../theme';
import type { PumpListItem } from '../types';

export const DevicesView: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const { pumps, loading, reload } = usePumps();
  const [commissionOpen, setCommissionOpen] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [editingPump, setEditingPump] = useState<PumpListItem | null>(null);
  const [allocateOpen, setAllocateOpen] = useState(false);
  const [applyTemplateOpen, setApplyTemplateOpen] = useState(false);
  const [selection, setSelection] = useState<GridRowSelectionModel>({ type: 'include', ids: new Set() });

  const isSuperadmin = user?.role === 'superadmin';
  const isCustomer = user?.role === 'customer';
  // FR-WEB-013 — bulk allocation is a stock-management action for anyone
  // who can own/reassign fleet devices; the backend re-enforces this and
  // additionally scopes the target account to the caller's own hierarchy.
  const canAllocate = Boolean(user) && !isCustomer;
  // FR-WEB-032 — same set of roles config-templates endpoints allow.
  const canApplyTemplate = canAllocate;
  const selectedIds = Array.from(selection.ids).map(String);

  async function handleDelete(id: string) {
    if (!window.confirm(`Superadmin action: delete device ${id} from the database? This cannot be undone.`)) return;
    try {
      await deletePump(id);
      showToast(`Device ${id} deleted successfully`);
      reload();
    } catch (err: any) {
      showToast(err.message || 'Delete failed', true);
    }
  }

  const columns: GridColDef<PumpListItem>[] = useMemo(
    () => [
      // `flex` alone has no floor: on a narrow screen every column (including the device's own id) would
      // shrink to fit and ellipsize into illegibility rather than the grid scrolling horizontally. A
      // `minWidth` per column gives DataGrid a point below which it scrolls instead of over-shrinking.
      { field: 'id', headerName: 'Device ID (Thing Name)', flex: 1.2, minWidth: 170, renderCell: p => <span style={{ fontFamily: monoFont, fontWeight: 700 }}>{p.value}</span> },
      { field: 'supply_type', headerName: 'Supply Type', flex: 0.8, minWidth: 110 },
      { field: 'firmware_version', headerName: 'Firmware', flex: 0.7, minWidth: 100, valueGetter: (_v, row) => row.firmware_version || '—' },
      {
        field: 'location',
        headerName: 'GPS Location',
        flex: 1,
        minWidth: 170,
        valueGetter: (_v, row) => formatCoords(row.latitude, row.longitude)
      },
      {
        field: 'status',
        headerName: 'Status',
        flex: 0.8,
        minWidth: 110,
        valueGetter: (_v, row) => effectiveStatus(row),
        renderCell: p => {
          const color =
            p.value === 'RUNNING' ? theme.palette.secondary.main
            : p.value === 'FAULT' ? theme.palette.error.main
            : p.value === 'OFFLINE' ? theme.palette.warning.main
            : theme.palette.text.secondary;
          return <Chip size="small" label={STATUS_LABEL[p.value as keyof typeof STATUS_LABEL]} sx={{ color, bgcolor: `${color}1F`, fontFamily: monoFont, fontWeight: 700 }} />;
        }
      },
      {
        // FR-WEB-030 — "stock view": pre-commissioning inventory
        // (MANUFACTURED/ALLOCATED/IN_STOCK) vs. deployed devices is a
        // filter on this column, not a separate page — DataGrid's built-in
        // column filter already does the job once lifecycle_state is a
        // visible column.
        field: 'lifecycle_state',
        headerName: 'Lifecycle',
        flex: 0.9,
        minWidth: 130, // "MANUFACTURED" is the longest value; must not ellipsize the very thing being filtered on
        renderCell: p => <Chip size="small" label={p.value} variant="outlined" sx={{ fontFamily: monoFont }} />
      },
      {
        field: 'actions',
        headerName: 'Actions',
        flex: 1,
        minWidth: 100,
        sortable: false,
        filterable: false,
        renderCell: p =>
          isSuperadmin ? (
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Tooltip title="Edit location">
                <IconButton
                  size="small"
                  onClick={e => {
                    e.stopPropagation();
                    setEditingPump(p.row);
                    setCommissionOpen(true);
                  }}
                >
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete device">
                <IconButton
                  size="small"
                  color="error"
                  onClick={e => {
                    e.stopPropagation();
                    handleDelete(p.row.id);
                  }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          ) : isCustomer ? (
            <Typography variant="caption" color="text.secondary">
              End owner
            </Typography>
          ) : null
      }
    ],
    [isSuperadmin, isCustomer, theme]
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h4">Hardware Device Registry &amp; Fleet Inventory</Typography>
          <Typography variant="caption" color="text.secondary">
            {isSuperadmin ? 'Superadmin mode: full create, edit and delete privileges' : isCustomer ? 'End customer view: assigned personal fleet' : 'Subordinate device assignment enabled'}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {canAllocate && selectedIds.length > 0 && (
            <Button variant="tonal" startIcon={<SwapHorizIcon />} onClick={() => setAllocateOpen(true)}>
              Allocate ({selectedIds.length})
            </Button>
          )}
          {canApplyTemplate && selectedIds.length > 0 && (
            <Button variant="tonal" startIcon={<TuneIcon />} onClick={() => setApplyTemplateOpen(true)}>
              Apply Template ({selectedIds.length})
            </Button>
          )}
          {isSuperadmin && (
            <>
              <Button
                variant="outlined"
                color="secondary"
                startIcon={<UploadFileIcon />}
                onClick={() => setBulkImportOpen(true)}
              >
                Bulk Import CSV
              </Button>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => {
                  setEditingPump(null);
                  setCommissionOpen(true);
                }}
              >
                Register Device
              </Button>
            </>
          )}
        </Box>
      </Box>

      <Card elevation={1} sx={{ flex: 1, overflow: 'hidden' }}>
        <DataGrid
          rows={pumps}
          columns={columns}
          loading={loading}
          density="comfortable"
          pageSizeOptions={[10, 25, 50]}
          initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
          checkboxSelection={canAllocate}
          rowSelectionModel={selection}
          onRowSelectionModelChange={setSelection}
          disableRowSelectionOnClick
          onRowClick={p => navigate(`/devices/${encodeURIComponent(p.row.id)}`)}
          showToolbar
          sx={{ border: 'none', height: '100%', '& .MuiDataGrid-row': { cursor: 'pointer' } }}
        />
      </Card>

      <BulkImportModal
        open={bulkImportOpen}
        onClose={() => setBulkImportOpen(false)}
        onSuccess={reload}
      />
      <CommissionDialog
        open={commissionOpen}
        onClose={() => setCommissionOpen(false)}
        onSaved={reload}
        editingPump={editingPump}
      />
      <AllocateDialog
        open={allocateOpen}
        onClose={() => setAllocateOpen(false)}
        onAllocated={() => {
          reload();
          setSelection({ type: 'include', ids: new Set() });
        }}
        pumpIds={selectedIds}
      />
      <ApplyTemplateDialog
        open={applyTemplateOpen}
        onClose={() => setApplyTemplateOpen(false)}
        onApplied={() => {
          reload();
          setSelection({ type: 'include', ids: new Set() });
        }}
        pumpIds={selectedIds}
      />
    </Box>
  );
};
