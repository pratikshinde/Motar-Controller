import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

const mocks = vi.hoisted(() => ({
  fetchAlerts: vi.fn(),
  fetchSystemHealth: vi.fn(),
  fetchAuditLog: vi.fn(),
  showToast: vi.fn(),
  navigate: vi.fn()
}));

vi.mock('../../api/alerts', () => ({ fetchAlerts: mocks.fetchAlerts, resolveAlert: vi.fn() }));
vi.mock('../../api/systemHealth', () => ({ fetchSystemHealth: mocks.fetchSystemHealth }));
vi.mock('../../api/audit', () => ({ fetchAuditLog: mocks.fetchAuditLog }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock('../../context/WebSocketContext', () => ({ useWs: () => ({ subscribe: () => () => {} }) }));
vi.mock('../../components/ResolveAlertDialog', () => ({ ResolveAlertDialog: ({ open, alertId }: any) => (open ? <div data-testid="resolve-dialog">{alertId}</div> : null) }));
vi.mock('react-router-dom', async importOriginal => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => mocks.navigate }));

import { AlertsView } from '../AlertsView';
import { SystemHealthView } from '../SystemHealthView';
import { AuditLogView } from '../AuditLogView';
import { buildAppTheme } from '../../theme';

const themed = (ui: React.ReactElement) => render(<ThemeProvider theme={buildAppTheme('dark')}><MemoryRouter>{ui}</MemoryRouter></ThemeProvider>);
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const alert = (id: string, over: any = {}) => ({
  id, pump_id: `P-${id}`, pump_name: `Pump ${id}`, alert_type: 'FAULT', severity: 'CRITICAL', fault_code: 3, fault_name: 'Dry run', source_fault_log_id: null,
  occurrence_count: 1, first_occurred_at: ago(3600_000), last_occurred_at: ago(2 * 3600_000), acknowledged_by: null, acknowledged_by_name: null,
  acknowledged_at: null, assigned_to: null, assigned_to_name: null, resolved_at: null, resolution_note: null, ...over
});

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockReset());
});

describe('Alerts', () => {
  it('says plainly what happened, to which pump and how long ago', async () => {
    mocks.fetchAlerts.mockResolvedValue({ alerts: [alert('1'), alert('2', { alert_type: 'OFFLINE', fault_name: null, severity: 'MEDIUM', occurrence_count: 3 })] });
    themed(<AlertsView />);
    const first = await screen.findByTestId('alert-1');
    expect(within(first).getByText('Dry run')).toBeInTheDocument();
    expect(within(first).getByText('Pump 1')).toBeInTheDocument();
    expect(within(first).getByText('2 hours ago')).toBeInTheDocument();
    expect(within(first).getByText('Urgent')).toBeInTheDocument();
    const second = screen.getByTestId('alert-2');
    expect(within(second).getByText('Pump went offline')).toBeInTheDocument();
    expect(within(second).getByText('3 times')).toBeInTheDocument();
    expect(within(second).queryByText('Urgent')).not.toBeInTheDocument();
  });

  it('shows the open ones first and asks the server for what is chosen', async () => {
    mocks.fetchAlerts.mockResolvedValue({ alerts: [] });
    themed(<AlertsView />);
    await waitFor(() => expect(mocks.fetchAlerts).toHaveBeenCalledWith({ status: 'open' }));
    await userEvent.click(screen.getByTestId('show-resolved'));
    await waitFor(() => expect(mocks.fetchAlerts).toHaveBeenLastCalledWith({ status: 'resolved' }));
    await userEvent.click(screen.getByTestId('show-all'));
    await waitFor(() => expect(mocks.fetchAlerts).toHaveBeenLastCalledWith({ status: undefined }));
  });

  it('offers Resolve for an open alert, and shows a resolved one with its note and no button', async () => {
    mocks.fetchAlerts.mockResolvedValue({ alerts: [alert('1'), alert('2', { resolved_at: ago(60_000), resolution_note: 'Cleaned the filter' })] });
    themed(<AlertsView />);
    await screen.findByTestId('alert-1');
    expect(screen.queryByTestId('resolve-2')).not.toBeInTheDocument();
    expect(screen.getByText('Cleaned the filter')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('resolve-1'));
    expect(screen.getByTestId('resolve-dialog')).toHaveTextContent('1');
  });

  it('says all clear when nothing needs attention, and has no acknowledge, assign or subscriptions to confuse', async () => {
    mocks.fetchAlerts.mockResolvedValue({ alerts: [] });
    themed(<AlertsView />);
    expect(await screen.findByTestId('no-alerts')).toHaveTextContent('All clear');
    for (const gone of [/acknowledge/i, /assign/i, /subscriptions/i, /severity/i]) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument();
    }
  });

  it('opens the pump when its name is clicked', async () => {
    mocks.fetchAlerts.mockResolvedValue({ alerts: [alert('1')] });
    themed(<AlertsView />);
    await userEvent.click(await screen.findByText('Pump 1'));
    expect(mocks.navigate).toHaveBeenCalledWith('/devices/P-1');
  });
});

describe('Platform health', () => {
  const health = (over: any = {}) => ({
    status: 'OK', timestamp: '', process: { uptime_seconds: 90_000, env: 'production' },
    database: { connected: true, latency_ms: 4, pool_total: 5, pool_idle: 4, pool_waiting: 0 },
    metrics: { requests_total: 1000, errors_5xx: 1, errors_4xx: 10, telemetry_ingest_success: 500, telemetry_ingest_failure: 2 }, ...over
  });

  it('says everything is working, in plain tiles', async () => {
    mocks.fetchSystemHealth.mockResolvedValue(health());
    themed(<SystemHealthView />);
    expect(await screen.findByText('Everything is working')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-uptime')).getByText('1d 1h')).toBeInTheDocument();
    expect(screen.getByTestId('tile-database')).toHaveTextContent('Working');
    expect(screen.getByTestId('tile-database')).toHaveTextContent('answers in 4 ms');
    expect(screen.getByTestId('tile-readings')).toHaveTextContent('500');
    expect(screen.queryByText(/python|fastapi|sms|whatsapp/i)).not.toBeInTheDocument();
  });

  it('says what is wrong when the database stops answering', async () => {
    mocks.fetchSystemHealth.mockResolvedValue(health({ status: 'DEGRADED', database: { connected: false } }));
    themed(<SystemHealthView />);
    expect(await screen.findByText('Something needs attention')).toBeInTheDocument();
    expect(screen.getByTestId('health-problems')).toHaveTextContent('The database is not answering.');
    expect(screen.getByTestId('tile-database')).toHaveTextContent('Not answering');
  });

  it('flags failing requests and rejected pump readings', async () => {
    mocks.fetchSystemHealth.mockResolvedValue(health({ metrics: { requests_total: 100, errors_5xx: 20, telemetry_ingest_success: 5, telemetry_ingest_failure: 50 } }));
    themed(<SystemHealthView />);
    const problems = await screen.findByTestId('health-problems');
    expect(problems).toHaveTextContent('failing on the server');
    expect(problems).toHaveTextContent('readings are being rejected');
  });
});

describe('Activity log', () => {
  const entry = (id: number, action: string, over: any = {}) => ({ id, actor_id: 'a', actor_role: 'manufacturer', entity_type: 'user', entity_id: `e${id}`, action, before_json: null, after_json: null, ip: null, occurred_at: ago(id * 60_000), ...over });

  it('lists what happened in plain sentences with who did it and when, newest first', async () => {
    mocks.fetchAuditLog.mockResolvedValue({ count: 3, entries: [entry(3, 'FARMER_REGISTERED'), entry(1, 'USER_CREATED'), entry(2, 'SET_WARRANTY')] });
    themed(<AuditLogView />);
    const rows = await screen.findAllByTestId(/^entry-/);
    expect(rows.map(r => r.getAttribute('data-testid'))).toEqual(['entry-1', 'entry-2', 'entry-3']);
    expect(within(rows[0]).getByText('Added an account')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Admin')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Set a warranty')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Registered a farmer')).toBeInTheDocument();
    expect(screen.queryByText(/json|before|after/i)).not.toBeInTheDocument();
  });

  it('filters by what the action was about', async () => {
    mocks.fetchAuditLog.mockResolvedValue({ count: 0, entries: [] });
    themed(<AuditLogView />);
    await waitFor(() => expect(mocks.fetchAuditLog).toHaveBeenCalledWith(undefined));
    await userEvent.click(screen.getByTestId('group-pump'));
    await waitFor(() => expect(mocks.fetchAuditLog).toHaveBeenLastCalledWith('pump'));
    await userEvent.click(screen.getByTestId('group-user'));
    await waitFor(() => expect(mocks.fetchAuditLog).toHaveBeenLastCalledWith('user'));
  });

  it('searches the sentences', async () => {
    mocks.fetchAuditLog.mockResolvedValue({ count: 2, entries: [entry(1, 'USER_CREATED'), entry(2, 'FARMER_STOPPED')] });
    themed(<AuditLogView />);
    await screen.findByTestId('entry-1');
    await userEvent.type(screen.getByPlaceholderText('Search'), 'farmer');
    expect(screen.queryByTestId('entry-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('entry-2')).toBeInTheDocument();
    await userEvent.clear(screen.getByPlaceholderText('Search'));
    await userEvent.type(screen.getByPlaceholderText('Search'), 'zzz');
    expect(await screen.findByTestId('no-activity')).toHaveTextContent('Nothing matches that search.');
  });

  it('says so when nothing has happened yet', async () => {
    mocks.fetchAuditLog.mockResolvedValue({ count: 0, entries: [] });
    themed(<AuditLogView />);
    expect(await screen.findByTestId('no-activity')).toHaveTextContent('Nothing has happened yet.');
  });
});
