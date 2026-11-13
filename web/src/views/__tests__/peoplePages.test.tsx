import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

const mocks = vi.hoisted(() => ({ fetchTeam: vi.fn(), fetchFarmers: vi.fn(), navigate: vi.fn(), role: 'manufacturer' }));

vi.mock('../../api/team', async importOriginal => ({ ...(await importOriginal<typeof import('../../api/team')>()), fetchTeam: mocks.fetchTeam }));
vi.mock('../../api/farmers', async importOriginal => ({ ...(await importOriginal<typeof import('../../api/farmers')>()), fetchFarmers: mocks.fetchFarmers }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', role: mocks.role } }) }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('@mui/x-charts/PieChart', () => ({ PieChart: () => <div data-testid="pie" /> }));
vi.mock('@mui/x-charts/BarChart', () => ({ BarChart: () => <div data-testid="bar" /> }));
vi.mock('../../components/AddSubordinateDialog', () => ({
  AddSubordinateDialog: ({ open, underRole, lockRole, parentId }: any) => (open ? <div data-testid="add-partner">{`${underRole}|${lockRole}|${parentId ?? ''}`}</div> : null)
}));
vi.mock('../../components/AddFarmerDialog', () => ({ AddFarmerDialog: ({ open }: any) => (open ? <div data-testid="add-farmer" /> : null) }));
vi.mock('../../components/NewPartnerQrDialog', () => ({ NewPartnerQrDialog: ({ target }: any) => (target ? <div data-testid="qr-dialog">{target.full_name}</div> : null) }));
vi.mock('../../components/people/FarmerActions', async importOriginal => ({
  ...(await importOriginal<typeof import('../../components/people/FarmerActions')>()),
  FarmerActions: ({ farmer }: any) => <div data-testid="farmer-actions">{farmer.full_name}</div>
}));

import { PeopleView } from '../people/PeopleView';
import { PersonDashboardView } from '../people/PersonDashboardView';
import { ManagerDashboardView } from '../people/ManagerDashboardView';
import { buildAppTheme } from '../../theme';
import type { TeamMember } from '../../api/team';

const buckets = (over: any = {}) => ({ total: 0, running: 0, stopped: 0, fault: 0, offline: 0, no_data: 0, ...over });
const member = (id: string, role: TeamMember['role'], name: string, over: Partial<TeamMember> = {}): TeamMember => ({
  id, role, full_name: name, phone_number: `+9190000${id.padStart(5, '0')}`, email: null, address: null, account_status: 'ACTIVE',
  has_signed_in: role === 'customer' ? null : true, created_at: '2026-10-01T00:00:00Z', above: [],
  pumps: buckets(), gsm_pumps: 0, gsm_online: 0, distributors: 0, dealers: 0, farmers: 0, ...over
});

const people: TeamMember[] = [
  member('1', 'distributor', 'Suresh Patil', { has_signed_in: false, dealers: 2, farmers: 3, pumps: buckets({ total: 5, running: 2 }), gsm_pumps: 4, gsm_online: 3 }),
  member('2', 'distributor', 'Mahesh Kale', { dealers: 1, farmers: 1, pumps: buckets({ total: 1 }) }),
  member('11', 'dealer', 'Ramesh Traders', { above: [{ id: '1', name: 'Suresh Patil', role: 'distributor' }], farmers: 2, pumps: buckets({ total: 3, running: 1 }) }),
  member('12', 'dealer', 'Anil Agro', { above: [{ id: '1', name: 'Suresh Patil', role: 'distributor' }], farmers: 1, pumps: buckets({ total: 2, running: 1 }) }),
  member('13', 'dealer', 'Direct Dealer', {}),
  member('101', 'customer', 'Ganesh Jadhav', { above: [{ id: '1', name: 'Suresh Patil', role: 'distributor' }, { id: '11', name: 'Ramesh Traders', role: 'dealer' }], pumps: buckets({ total: 2, running: 1 }) }),
  member('102', 'customer', 'Sunita Pawar', { above: [{ id: '1', name: 'Suresh Patil', role: 'distributor' }, { id: '11', name: 'Ramesh Traders', role: 'dealer' }], pumps: buckets({ total: 1 }) })
];

const summary = {
  pumps: buckets({ total: 8, running: 4, stopped: 2, offline: 1, no_data: 1 }), gsm_pumps: 6, gsm_online: 5, distributors: 2, dealers: 3, farmers: 2,
  monthly_pumps: [
    { month: '2026-06', pumps: 0 }, { month: '2026-07', pumps: 1 }, { month: '2026-08', pumps: 2 },
    { month: '2026-09', pumps: 1 }, { month: '2026-10', pumps: 2 }, { month: '2026-11', pumps: 2 }
  ],
  waiting_to_sign_in: 4
};

const Where = () => <span data-testid="where">{useLocation().pathname + useLocation().search}</span>;
const themed = (ui: React.ReactElement, url = '/') =>
  render(
    <ThemeProvider theme={buildAppTheme('dark')}>
      <MemoryRouter initialEntries={[url]}>
        {ui}
        <Where />
      </MemoryRouter>
    </ThemeProvider>
  );

beforeEach(() => {
  Object.values(mocks).forEach(m => typeof m === 'function' && (m as ReturnType<typeof vi.fn>).mockReset());
  mocks.role = 'manufacturer';
  mocks.fetchTeam.mockResolvedValue({ summary, people });
  mocks.fetchFarmers.mockResolvedValue({
    farmers: [{ id: '101', full_name: 'Ganesh Jadhav', phone_number: '+919000000101', address: 'Hadapsar, Pune', status: 'ACTIVE', created_at: null,
      pumps: [{ id: 'AJ-1', name: 'Ganesh pump', hp_rating: 5, status: 'RUNNING', lifecycle_state: 'ACTIVE' }], qr: { state: 'CLAIMED', expires_at: null, claimed_at: null } }]
  });
});

describe('People: one tab per level, each person a card', () => {
  const open = (url = '/people') => themed(<Routes><Route path="/people" element={<PeopleView />} /></Routes>, url);

  it('has Distributors, Dealers and Farmers tabs with their counts, opening on the distributors', async () => {
    open();
    expect(await screen.findByTestId('tab-distributor')).toHaveTextContent('Distributors (2)');
    expect(screen.getByTestId('tab-dealer')).toHaveTextContent('Dealers (3)');
    expect(screen.getByTestId('tab-customer')).toHaveTextContent('Farmers (2)');
    expect(await screen.findByTestId('person-1')).toBeInTheDocument();
    expect(screen.getByTestId('person-2')).toBeInTheDocument();
    expect(screen.queryByTestId('person-11')).not.toBeInTheDocument();
  });

  it('shows each distributor as a card with its numbers, and who has not opened their QR', async () => {
    open();
    const card = await screen.findByTestId('person-1');
    expect(within(card).getByText('Suresh Patil')).toBeInTheDocument();
    expect(within(card).getByText('Dealers')).toBeInTheDocument();
    expect(within(card).getByText('Running')).toBeInTheDocument();
    expect(within(card).getByTestId('unclaimed-1')).toBeInTheDocument();
    expect(within(screen.getByTestId('person-2')).queryByTestId('unclaimed-2')).not.toBeInTheDocument();
  });

  it('switches to the dealers, who say who they sit under, and keeps the tab in the address', async () => {
    open();
    await userEvent.click(await screen.findByTestId('tab-dealer'));
    expect(await screen.findByTestId('person-11')).toHaveTextContent('Under: Suresh Patil');
    expect(screen.getByTestId('person-13')).toHaveTextContent('Under: Direct');
    expect(screen.getByTestId('where')).toHaveTextContent('/people?tab=dealer');
  });

  it('has an add button on each tab: distributor, dealer, farmer', async () => {
    open();
    await userEvent.click(await screen.findByTestId('add-person'));
    expect(screen.getByTestId('add-partner')).toHaveTextContent('distributor|true|');
    await userEvent.click(screen.getByTestId('tab-dealer'));
    expect(screen.getByTestId('add-person')).toHaveTextContent('Add dealer');
    await userEvent.click(screen.getByTestId('tab-customer'));
    expect(screen.getByTestId('add-person')).toHaveTextContent('Add farmer');
    await userEvent.click(screen.getByTestId('add-person'));
    expect(screen.getByTestId('add-farmer')).toBeInTheDocument();
  });

  it('opens that person dashboard when a card is clicked', async () => {
    open();
    await userEvent.click(within(await screen.findByTestId('person-1')).getByText('Suresh Patil'));
    expect(screen.getByTestId('where')).toHaveTextContent('/people/1');
  });

  it('searches by name, mobile number or who they are under', async () => {
    open('/people?tab=customer');
    await screen.findByTestId('person-101');
    await userEvent.type(screen.getByPlaceholderText(/search by name/i), 'sunita');
    expect(screen.queryByTestId('person-101')).not.toBeInTheDocument();
    expect(screen.getByTestId('person-102')).toBeInTheDocument();
    await userEvent.clear(screen.getByPlaceholderText(/search by name/i));
    await userEvent.type(screen.getByPlaceholderText(/search by name/i), 'zzz');
    expect(await screen.findByText('Nobody matches that search.')).toBeInTheDocument();
  });

  it('gives a distributor the dealers and farmers tabs only, and a dealer the farmers only', async () => {
    mocks.role = 'distributor';
    const first = open();
    await screen.findByTestId('tab-dealer');
    expect(screen.queryByTestId('tab-distributor')).not.toBeInTheDocument();
    expect(screen.getByTestId('tab-customer')).toBeInTheDocument();
    first.unmount();
    mocks.role = 'dealer';
    open();
    expect(await screen.findByTestId('person-101')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-dealer')).not.toBeInTheDocument();
  });

  it('gives a dealer a plain Farmers page: one card per farmer, no tabs, an Add farmer button', async () => {
    mocks.role = 'dealer';
    open();
    expect(await screen.findByRole('heading', { name: 'Farmers' })).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getByTestId('person-101')).toBeInTheDocument();
    expect(screen.getByTestId('person-102')).toBeInTheDocument();
    expect(screen.queryByTestId('person-11')).not.toBeInTheDocument();
    expect(screen.getByTestId('add-person')).toHaveTextContent('Add farmer');
  });

  it('opens the new QR for a distributor from its card', async () => {
    open();
    await userEvent.click(await screen.findByTestId('new-qr-1'));
    expect(screen.getByTestId('qr-dialog')).toHaveTextContent('Suresh Patil');
  });

  it('says plainly when a tab is empty', async () => {
    mocks.fetchTeam.mockResolvedValue({ summary, people: [] });
    open();
    expect(await screen.findByTestId('empty')).toHaveTextContent('No distributors yet');
  });
});

describe('a person own dashboard', () => {
  const open = (id: string) => themed(<Routes><Route path="/people/:id" element={<PersonDashboardView />} /></Routes>, `/people/${id}`);

  it('shows a distributor numbers, the dealers and farmers under them, and offers to add a dealer', async () => {
    open('1');
    expect(within(await screen.findByTestId('tile-pumps')).getByText('5')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-dealers')).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-farmers')).getByText('3')).toBeInTheDocument();
    expect(screen.getByTestId('tile-gsm')).toHaveTextContent('of 4 on GSM');
    expect(screen.getByText('Dealers under Suresh Patil (2)')).toBeInTheDocument();
    expect(screen.getByTestId('person-11')).toBeInTheDocument();
    expect(screen.getByText('Farmers under Suresh Patil (2)')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('add-dealer-under'));
    expect(screen.getByTestId('add-partner')).toHaveTextContent('dealer|true|1');
  });

  it('shows a dealer its farmers only, with no add-dealer button', async () => {
    open('11');
    await screen.findByTestId('tile-farmers');
    expect(screen.queryByTestId('tile-dealers')).not.toBeInTheDocument();
    expect(screen.queryByTestId('add-dealer-under')).not.toBeInTheDocument();
    expect(screen.getByText('Farmers under Ramesh Traders (2)')).toBeInTheDocument();
    expect(screen.queryByText(/Dealers under/)).not.toBeInTheDocument();
  });

  it('opens a farmer with the pump, the app state and the things that can be done', async () => {
    open('101');
    expect(within(await screen.findByTestId('tile-pumps')).getByText('2')).toBeInTheDocument();
    expect(screen.getByTestId('farmer-actions')).toHaveTextContent('Ganesh Jadhav');
    const details = await screen.findByTestId('farmer-details');
    expect(details).toHaveTextContent('Farmer is using the app');
    expect(details).toHaveTextContent('AJ-1');
  });

  it('has a Hierarchy button for a distributor that opens that branch', async () => {
    open('1');
    await userEvent.click(await screen.findByTestId('open-hierarchy'));
    expect(screen.getByTestId('where')).toHaveTextContent('/hierarchy?of=1');
  });

  it('has no Hierarchy button on a dealer, who has only farmers under them', async () => {
    open('11');
    await screen.findByTestId('tile-farmers');
    expect(screen.queryByTestId('open-hierarchy')).not.toBeInTheDocument();
  });

  it('has a back button to the right tab', async () => {
    open('11');
    await userEvent.click(await screen.findByTestId('back-to-people'));
    expect(screen.getByTestId('where')).toHaveTextContent('/people?tab=dealer');
  });

  it('says so for someone who is not under you', async () => {
    open('999');
    expect(await screen.findByText(/not found under you/i)).toBeInTheDocument();
  });

  it('offers a new QR for a distributor or dealer, never for a farmer', async () => {
    const first = open('11');
    await userEvent.click(await screen.findByTestId('new-qr'));
    expect(screen.getByTestId('qr-dialog')).toHaveTextContent('Ramesh Traders');
    first.unmount();
    open('101');
    await screen.findByTestId('farmer-actions');
    expect(screen.queryByTestId('new-qr')).not.toBeInTheDocument();
  });
});

describe('the dashboard of an admin, a distributor or a dealer', () => {
  const open = () => themed(<ManagerDashboardView />);

  it('shows the admin pumps running, distributors, dealers, farmers and GSM pumps running', async () => {
    open();
    expect(within(await screen.findByTestId('tile-running')).getByText('4')).toBeInTheDocument();
    expect(screen.getByTestId('tile-running')).toHaveTextContent('of 8 pumps');
    expect(within(screen.getByTestId('tile-distributors')).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-dealers')).getByText('3')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-farmers')).getByText('2')).toBeInTheDocument();
    expect(screen.getByTestId('tile-gsm')).toHaveTextContent('of 6 on GSM');
  });

  it('has a Hierarchy button for the admin and a distributor, and not for a dealer', async () => {
    const first = open();
    await userEvent.click(await screen.findByTestId('open-hierarchy'));
    expect(screen.getByTestId('where')).toHaveTextContent('/hierarchy');
    first.unmount();
    mocks.role = 'distributor';
    const second = open();
    expect(await screen.findByTestId('open-hierarchy')).toBeInTheDocument();
    second.unmount();
    mocks.role = 'dealer';
    open();
    await screen.findByTestId('tile-running');
    expect(screen.queryByTestId('open-hierarchy')).not.toBeInTheDocument();
  });

  it('draws the state donut, a comparison of the level below, and the monthly growth', async () => {
    open();
    expect(await screen.findByTestId('chart-status')).toBeInTheDocument();
    expect(screen.getByTestId('chart-below')).toHaveTextContent('Pumps per distributor');
    expect(screen.getByTestId('chart-monthly')).toBeInTheDocument();
  });

  it('leaves out what a distributor and a dealer do not have', async () => {
    mocks.role = 'distributor';
    const first = open();
    await screen.findByTestId('tile-running');
    expect(screen.queryByTestId('tile-distributors')).not.toBeInTheDocument();
    expect(screen.getByTestId('chart-below')).toHaveTextContent('Pumps per dealer');
    first.unmount();
    mocks.role = 'dealer';
    open();
    await screen.findByTestId('tile-running');
    expect(screen.queryByTestId('tile-dealers')).not.toBeInTheDocument();
    expect(screen.getByTestId('chart-below')).toHaveTextContent('Pumps per farmer');
  });
});
