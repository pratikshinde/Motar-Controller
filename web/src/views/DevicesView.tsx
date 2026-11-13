import React, { useMemo, useState } from 'react';
import { Box, Button, Chip, Card, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { DataGrid, type GridColDef, type GridRowSelectionModel } from '@mui/x-data-grid';
import SendIcon from '@mui/icons-material/Send';
import { useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { usePumps } from '../hooks/usePumps';
import { useAuth } from '../context/AuthContext';
import { AllocateDialog } from '../components/AllocateDialog';
import { effectiveStatus, STATUS_LABEL } from '../utils/pumpStatus';
import { monoFont } from '../theme';
import type { PumpListItem } from '../types';

/** A starter that has not been given to a farmer yet: it can still be handed to a distributor or a dealer. */
export const STOCK_STATES = new Set(['MANUFACTURED', 'IN_STOCK', 'ALLOCATED']);
export const isInStock = (p: Pick<PumpListItem, 'lifecycle_state'>) => STOCK_STATES.has(p.lifecycle_state);

type Filter = 'ALL' | 'STOCK' | 'IN_USE';

/** The starters and pumps under you, and the ones still in stock that you can give to a distributor or dealer under you. */
export const DevicesView: React.FC = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { pumps, loading, reload } = usePumps();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [giveOpen, setGiveOpen] = useState(false);
  const [selection, setSelection] = useState<GridRowSelectionModel>({ type: 'include', ids: new Set() });

  // The admin gives stock to its distributors and dealers, a distributor to its dealers. A dealer gives starters to farmers by registering them.
  const canGive = user?.role === 'manufacturer' || user?.role === 'distributor';
  const selectedIds = Array.from(selection.ids).map(String);

  const stock = pumps.filter(isInStock);
  const inUse = pumps.filter(p => !isInStock(p));
  const shown = filter === 'STOCK' ? stock : filter === 'IN_USE' ? inUse : pumps;

  const columns: GridColDef<PumpListItem>[] = useMemo(
    () => [
      { field: 'id', headerName: 'Starter ID', flex: 1.2, minWidth: 170, renderCell: p => <span style={{ fontFamily: monoFont, fontWeight: 700 }}>{p.value}</span> },
      { field: 'name', headerName: 'Name', flex: 1, minWidth: 140 },
      { field: 'hp_rating', headerName: 'HP', width: 80, valueGetter: (_v, row) => (row.hp_rating ? Number(row.hp_rating) : '—') },
      {
        field: 'device_type',
        headerName: 'Type',
        width: 120,
        valueGetter: (_v, row) => (row.device_type === 'SOLAR_VFD' ? 'Solar' : 'AC 3-phase')
      },
      {
        field: 'stock',
        headerName: 'Where it is',
        flex: 0.8,
        minWidth: 120,
        sortable: false,
        valueGetter: (_v, row) => (isInStock(row) ? 'In stock' : 'With a farmer'),
        renderCell: p => <Chip size="small" variant="outlined" label={p.value as string} color={p.value === 'In stock' ? 'info' : 'default'} />
      },
      {
        field: 'status',
        headerName: 'State',
        flex: 0.8,
        minWidth: 110,
        valueGetter: (_v, row) => effectiveStatus(row),
        renderCell: p => {
          const color =
            p.value === 'RUNNING' ? theme.palette.success.main
            : p.value === 'FAULT' ? theme.palette.error.main
            : p.value === 'OFFLINE' ? theme.palette.warning.main
            : theme.palette.text.secondary;
          return <Chip size="small" label={STATUS_LABEL[p.value as keyof typeof STATUS_LABEL]} sx={{ color, bgcolor: `${color}1F`, fontWeight: 700 }} />;
        }
      }
    ],
    [theme]
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1.5 }}>
        <Box>
          <Typography variant="body2" color="text.secondary">
            {canGive ? 'Your starters and pumps. Tick the ones in stock to give them to someone under you.' : 'Your starters and pumps.'}
          </Typography>
        </Box>
        {canGive && selectedIds.length > 0 && (
          <Button variant="contained" startIcon={<SendIcon />} onClick={() => setGiveOpen(true)} data-testid="give-stock">
            {user?.role === 'distributor' ? `Give ${selectedIds.length} to a dealer` : `Give ${selectedIds.length} to a distributor or dealer`}
          </Button>
        )}
      </Box>

      <ToggleButtonGroup value={filter} exclusive size="small" onChange={(_, v: Filter | null) => v && setFilter(v)} sx={{ alignSelf: 'flex-start' }}>
        <ToggleButton value="ALL" data-testid="filter-all">
          All ({pumps.length})
        </ToggleButton>
        <ToggleButton value="STOCK" data-testid="filter-stock">
          In stock ({stock.length})
        </ToggleButton>
        <ToggleButton value="IN_USE" data-testid="filter-in-use">
          With farmers ({inUse.length})
        </ToggleButton>
      </ToggleButtonGroup>

      <Card variant="outlined" sx={{ flex: 1, minHeight: 360, overflow: 'hidden', borderRadius: 3 }}>
        <DataGrid
          rows={shown}
          columns={columns}
          loading={loading}
          density="comfortable"
          pageSizeOptions={[10, 25, 50]}
          initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
          checkboxSelection={canGive}
          isRowSelectable={p => isInStock(p.row)}
          rowSelectionModel={selection}
          onRowSelectionModelChange={setSelection}
          disableRowSelectionOnClick
          onRowClick={p => navigate(`/devices/${encodeURIComponent(String(p.row.id))}`)}
          sx={{ border: 'none', height: '100%', '& .MuiDataGrid-row': { cursor: 'pointer' } }}
        />
      </Card>

      <AllocateDialog
        open={giveOpen}
        onClose={() => setGiveOpen(false)}
        onAllocated={() => {
          reload();
          setSelection({ type: 'include', ids: new Set() });
        }}
        pumpIds={selectedIds}
      />
    </Box>
  );
};
