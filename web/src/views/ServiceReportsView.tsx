import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Typography, Card, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { useNavigate } from 'react-router-dom';
import { fetchServiceReports } from '../api/serviceReports';
import { useToast } from '../context/ToastContext';
import { monoFont } from '../theme';
import type { ServiceReportRow } from '../types';

const WINDOWS = [7, 30, 90] as const;

// FR-WEB-037 — fault frequency, MTBF, runtime hours and uptime per device,
// computed live from fault_logs + telemetry_history (see the metric
// definitions comment on GET /api/service-reports in server.js). No
// precomputed rollup, no invented "subscription"/billing concept — every
// number here is a real aggregate over the selected window.
export const ServiceReportsView: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);
  const [rows, setRows] = useState<ServiceReportRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await fetchServiceReports(days);
      setRows(data.reports);
    } catch (err: any) {
      showToast(err.message || 'Could not load service reports', true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const columns: GridColDef<ServiceReportRow>[] = useMemo(
    () => [
      { field: 'name', headerName: 'Device', flex: 1.2 },
      { field: 'id', headerName: 'Device ID', flex: 1, renderCell: p => <span style={{ fontFamily: monoFont }}>{p.value}</span> },
      { field: 'fault_count', headerName: 'Faults', flex: 0.6, type: 'number' },
      {
        field: 'runtime_hours',
        headerName: 'Runtime (hrs)',
        flex: 0.8,
        type: 'number',
        valueGetter: (_v, row) => Number(row.runtime_hours)
      },
      {
        field: 'mtbf_hours',
        headerName: 'MTBF (hrs)',
        flex: 0.8,
        type: 'number',
        valueGetter: (_v, row) => (row.mtbf_hours === null ? null : Number(row.mtbf_hours)),
        renderCell: p => (p.value === null ? <span style={{ opacity: 0.6 }}>insufficient data</span> : p.value)
      },
      {
        field: 'uptime_pct',
        headerName: 'Uptime %',
        flex: 0.7,
        type: 'number',
        valueGetter: (_v, row) => Number(row.uptime_pct)
      }
    ],
    []
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
        <Box>
          <Typography variant="h4">Service Reports</Typography>
          <Typography variant="caption" color="text.secondary">
            Fault frequency, MTBF, runtime and uptime — for field service planning (FR-WEB-037)
          </Typography>
        </Box>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel id="service-report-window-label">Window</InputLabel>
          <Select
            labelId="service-report-window-label"
            label="Window"
            value={days}
            onChange={e => setDays(Number(e.target.value) as (typeof WINDOWS)[number])}
          >
            {WINDOWS.map(w => (
              <MenuItem key={w} value={w}>
                Last {w} days
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      <Card elevation={1} sx={{ flex: 1, overflow: 'hidden' }}>
        <DataGrid
          rows={rows}
          columns={columns}
          loading={loading}
          density="comfortable"
          pageSizeOptions={[10, 25, 50]}
          initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
          onRowClick={p => navigate(`/devices/${encodeURIComponent(p.row.id)}`)}
          showToolbar
          sx={{ border: 'none', height: '100%', '& .MuiDataGrid-row': { cursor: 'pointer' } }}
        />
      </Card>
    </Box>
  );
};
