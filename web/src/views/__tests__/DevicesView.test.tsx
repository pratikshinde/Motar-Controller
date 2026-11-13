import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

const mocks = vi.hoisted(() => ({ role: 'manufacturer', pumps: [] as any[], reload: vi.fn() }));

vi.mock('../../hooks/usePumps', () => ({ usePumps: () => ({ pumps: mocks.pumps, loading: false, reload: mocks.reload }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', role: mocks.role } }) }));
vi.mock('../../components/AllocateDialog', () => ({ AllocateDialog: ({ open, pumpIds }: any) => (open ? <div data-testid="give-dialog">{pumpIds.join(',')}</div> : null) }));

import { DevicesView } from '../DevicesView';
import { buildAppTheme } from '../../theme';

const pump = (id: string, lifecycle: string, over: any = {}) => ({
  id, name: `Pump ${id}`, device_type: 'AC_3PH', supply_type: '3-phase', hp_rating: 5, latitude: null, longitude: null, status: 'STOPPED',
  connectivity: 'ONLINE', lifecycle_state: lifecycle, firmware_version: null, last_seen_at: new Date().toISOString(), ...over
});

beforeEach(() => {
  mocks.role = 'manufacturer';
  mocks.reload.mockReset();
  mocks.pumps = [pump('S-1', 'IN_STOCK'), pump('S-2', 'ALLOCATED'), pump('F-1', 'ACTIVE', { status: 'RUNNING' })];
});

const open = () => render(<ThemeProvider theme={buildAppTheme('dark')}><MemoryRouter><div style={{ height: 600 }}><DevicesView /></div></MemoryRouter></ThemeProvider>);

describe('Devices', () => {
  it('counts the starters in stock and the ones with farmers', () => {
    open();
    expect(screen.getByTestId('filter-all')).toHaveTextContent('All (3)');
    expect(screen.getByTestId('filter-stock')).toHaveTextContent('In stock (2)');
    expect(screen.getByTestId('filter-in-use')).toHaveTextContent('With farmers (1)');
  });

  it('shows only what the chosen filter names', async () => {
    open();
    await userEvent.click(screen.getByTestId('filter-stock'));
    expect(screen.queryByText('F-1')).not.toBeInTheDocument();
    expect(screen.getByText('S-1')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('filter-in-use'));
    expect(screen.getByText('F-1')).toBeInTheDocument();
    expect(screen.queryByText('S-1')).not.toBeInTheDocument();
  });

  it('offers to give ticked stock to a distributor or dealer, and to a dealer only for a distributor', async () => {
    const first = open();
    const rows = screen.getAllByRole('checkbox');
    await userEvent.click(rows[1]);     // the first row (the header box is rows[0])
    expect(await screen.findByTestId('give-stock')).toHaveTextContent('Give 1 to a distributor or dealer');
    await userEvent.click(screen.getByTestId('give-stock'));
    expect(within(screen.getByTestId('give-dialog')).getByText(/S-/)).toBeInTheDocument();
    first.unmount();
    mocks.role = 'distributor';
    open();
    await userEvent.click(screen.getAllByRole('checkbox')[1]);
    expect(await screen.findByTestId('give-stock')).toHaveTextContent('Give 1 to a dealer');
  });

  it('gives a dealer no tick boxes and no give button: a dealer hands a starter over by registering a farmer', () => {
    mocks.role = 'dealer';
    open();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByTestId('give-stock')).not.toBeInTheDocument();
  });

  it('does not let a starter that is already with a farmer be ticked', () => {
    open();
    const row = screen.getByText('F-1').closest('[role="row"]') as HTMLElement;
    expect(within(row).getByRole('checkbox')).toBeDisabled();
  });
});
