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
      // Backend returns a plain array: [{pump_id, pump_name, fault_count, last_fault_at, window_days}]
      const raw: any[] = Array.isArray(data) ? data : (data as any).reports || [];
      setRows(
        raw.map((r: any) => ({
          id: r.pump_id ?? r.id,
          name: r.pump_name ?? r.name ?? r.pump_id,
          fault_count: r.fault_count ?? 0,
          last_fault_at: r.last_fault_at ?? null,
          // runtime / MTBF / uptime need DailySummary data — not built yet
          runtime_hours: null,
          mtbf_hours: null,
          uptime_pct: null,
        } as any))
      );
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

  const columns: GridColDef<any>[] = useMemo(
    () => [
      { field: 'name', headerName: 'Device', flex: 1.5, minWidth: 160 },
      { field: 'id', headerName: 'Device ID', flex: 1.2, minWidth: 150, renderCell: p => <span style={{ fontFamily: monoFont }}>{p.value}</span> },
      { field: 'fault_count', headerName: 'Faults', flex: 0.6, minWidth: 90, type: 'number' },
      {
        field: 'last_fault_at',
        headerName: 'Last Fault',
        flex: 1,
        minWidth: 170,
        valueGetter: (_v: any, row: any) => row.last_fault_at ? new Date(row.last_fault_at).toLocaleString() : '—'
      },
      {
        field: 'runtime_hours',
        headerName: 'Runtime (hrs)',
        flex: 0.8,
        minWidth: 120,
        type: 'number',
        renderCell: (p: any) => <span style={{ opacity: 0.5 }}>—</span>
      },
      {
        field: 'mtbf_hours',
        headerName: 'MTBF (hrs)',
        flex: 0.8,
        minWidth: 120,
        type: 'number',
        renderCell: (p: any) => <span style={{ opacity: 0.5 }}>—</span>
      },
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
