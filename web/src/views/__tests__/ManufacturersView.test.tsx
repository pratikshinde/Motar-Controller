import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';

const mocks = vi.hoisted(() => ({ fetchManufacturersOverview: vi.fn(), setManufacturerStatus: vi.fn(), setViewing: vi.fn(), navigate: vi.fn(), fetchAdminInvites: vi.fn(), sendAdminResetCode: vi.fn(), resendAdminInvite: vi.fn() }));

vi.mock('../../api/brands', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/brands')>()),
  fetchManufacturersOverview: mocks.fetchManufacturersOverview,
  setManufacturerStatus: mocks.setManufacturerStatus
}));
vi.mock('../../api/viewing', () => ({ setViewing: mocks.setViewing }));
vi.mock('../../api/adminInvites', () => ({ fetchAdminInvites: mocks.fetchAdminInvites, sendAdminResetCode: mocks.sendAdminResetCode, resendAdminInvite: mocks.resendAdminInvite }));
vi.mock('../../components/VerifyAdminInviteDialog', () => ({ VerifyAdminInviteDialog: ({ invite }: any) => (invite ? <div data-testid="verify-dialog">{invite.email}</div> : null) }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../components/AddManufacturerDialog', () => ({ AddManufacturerDialog: ({ open }: any) => (open ? <div data-testid="add-dialog" /> : null) }));
vi.mock('react-router-dom', async importOriginal => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => mocks.navigate }));

import { ManufacturersView } from '../ManufacturersView';
import { buildAppTheme } from '../../theme';

const buckets = { total: 12, running: 5, stopped: 4, fault: 1, offline: 1, no_data: 1 };
const maker = (key: string, name: string, owner: any, over: any = {}) => ({
  key, name, short_name: name, logo_url: null, primary_color: '#2e7d32', status: 'ACTIVE', owner,
  farmers: 30, team: 6, distributors: 2, dealers: 4, open_alerts: 0, pumps: buckets, gsm_pumps: 9, gsm_online: 7, joined: '2026-10-01T00:00:00Z', ...over
});

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockReset());
  mocks.fetchAdminInvites.mockResolvedValue({ invites: [] });
  mocks.fetchManufacturersOverview.mockResolvedValue({
    manufacturers: [
      maker('ajanta', 'Ajanta Pump Controller', { id: 'u-ajanta', name: 'Ajanta Admin', phone: null, email: 'admin@ajanta.test' }),
      maker('swati', 'SolarLogger', { name: 'Meera Joshi', phone: '+919999900012', email: null }, { status: 'SUSPENDED' })
    ],
    totals: { ...buckets, farmers: 60, open_alerts: 0, manufacturers: 2, distributors: 4, dealers: 8, gsm_pumps: 18, gsm_online: 14, monthly_pumps: [] }
  });
});

const open = () => render(<ThemeProvider theme={buildAppTheme('dark')}><ManufacturersView /></ThemeProvider>);

describe('the manufacturers: one card per registered admin', () => {
  it('has a card for each admin with who they are and the numbers that matter', async () => {
    open();
    const ajanta = await screen.findByTestId('card-ajanta');
    expect(within(ajanta).getByText('Ajanta Pump Controller')).toBeInTheDocument();
    expect(within(ajanta).getByText('Ajanta Admin · admin@ajanta.test')).toBeInTheDocument();
    for (const label of ['Pumps supplied', 'Running now', 'GSM online', 'Distributors', 'Dealers', 'Farmers']) {
      expect(within(ajanta).getByText(label)).toBeInTheDocument();
    }
    expect(within(ajanta).getByText('12')).toBeInTheDocument();
    expect(within(ajanta).getByText('7')).toBeInTheDocument();
    expect(within(ajanta).getByText(/^Added /)).toBeInTheDocument();
    expect(screen.getByTestId('card-swati')).toBeInTheDocument();
    expect(within(screen.getByTestId('card-swati')).getByText('App off')).toBeInTheDocument();
  });

  it('opens that admin dashboard when the card is clicked', async () => {
    open();
    const ajanta = await screen.findByTestId('card-ajanta');
    await userEvent.click(within(ajanta).getByText('Ajanta Pump Controller'));
    expect(mocks.navigate).toHaveBeenCalledWith('/manufacturers/ajanta');
  });

  it('has the option to register a new admin', async () => {
    open();
    await userEvent.click(await screen.findByTestId('register-admin'));
    expect(screen.getByTestId('add-dialog')).toBeInTheDocument();
  });

  it('switches an admin app off after asking, without opening the card', async () => {
    mocks.setManufacturerStatus.mockResolvedValue({ message: 'ok' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    open();
    await userEvent.click(await screen.findByTestId('toggle-ajanta'));
    expect(mocks.setManufacturerStatus).toHaveBeenCalledWith('ajanta', 'SUSPENDED');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('sends an admin who forgot the password a new code, after asking', async () => {
    mocks.sendAdminResetCode.mockResolvedValue({ invite: {} });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    open();
    await userEvent.click(await screen.findByTestId('new-code-ajanta'));
    expect(mocks.sendAdminResetCode).toHaveBeenCalledWith('u-ajanta');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('does not send anything when the question is answered No', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    open();
    await userEvent.click(await screen.findByTestId('new-code-ajanta'));
    expect(mocks.sendAdminResetCode).not.toHaveBeenCalled();
  });

  it('lists the admins whose email is not confirmed yet, apart from the manufacturers, with a way to enter the code or send a new one', async () => {
    mocks.fetchAdminInvites.mockResolvedValue({
      invites: [
        { id: 'inv1', full_name: 'Meera Joshi', company_name: 'New Co Pumps', address: 'Pune', phone: '+919876543210', email: 'meera@newco.test', brand: null, status: 'WAITING_FOR_CODE', created_at: null, expires_at: null, user_id: null },
        { id: 'inv2', full_name: 'Old One', company_name: 'Old Co', address: 'Pune', phone: '+919876543211', email: 'old@oldco.test', brand: null, status: 'EXPIRED', created_at: null, expires_at: null, user_id: null }
      ]
    });
    mocks.resendAdminInvite.mockResolvedValue({ invite: {} });
    open();
    const list = await screen.findByTestId('waiting-admins');
    expect(list).toHaveTextContent('Waiting to confirm their email (2)');
    const first = within(screen.getByTestId('waiting-inv1'));
    expect(first.getByText(/A code was sent to meera@newco.test/)).toBeInTheDocument();
    await userEvent.click(first.getByTestId('enter-code-inv1'));
    expect(screen.getByTestId('verify-dialog')).toHaveTextContent('meera@newco.test');
    await userEvent.click(first.getByTestId('send-again-inv1'));
    expect(mocks.resendAdminInvite).toHaveBeenCalledWith('inv1');
    const second = within(screen.getByTestId('waiting-inv2'));
    expect(second.getByText(/\(expired\)/)).toBeInTheDocument();
    expect(second.queryByTestId('enter-code-inv2')).not.toBeInTheDocument();
  });

  it('shows no waiting list when nobody is waiting', async () => {
    open();
    await screen.findByTestId('card-ajanta');
    expect(screen.queryByTestId('waiting-admins')).not.toBeInTheDocument();
  });

  it('says so when no admin is registered yet', async () => {
    mocks.fetchManufacturersOverview.mockResolvedValue({ manufacturers: [], totals: {} });
    open();
    expect(await screen.findByText(/no admins registered yet/i)).toBeInTheDocument();
  });
});
