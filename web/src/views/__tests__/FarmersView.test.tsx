import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FarmerRow } from '../../api/farmers';

const mocks = vi.hoisted(() => ({
  role: 'manufacturer',
  showToast: vi.fn(),
  fetchFarmers: vi.fn(),
  newFarmerQr: vi.fn(),
  updateFarmer: vi.fn(),
  deactivateFarmer: vi.fn(),
  activateFarmer: vi.fn()
}));

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'a1', role: mocks.role } }) }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock('../../api/farmers', () => ({
  fetchFarmers: mocks.fetchFarmers,
  newFarmerQr: mocks.newFarmerQr,
  updateFarmer: mocks.updateFarmer,
  deactivateFarmer: mocks.deactivateFarmer,
  activateFarmer: mocks.activateFarmer
}));

import { FarmersView } from '../FarmersView';

const farmer = (over: Partial<FarmerRow> = {}): FarmerRow => ({
  id: 'f1',
  full_name: 'Ramesh Patil',
  phone_number: '+919876501234',
  address: 'Plot 12, Hadapsar, Pune',
  created_at: '2026-11-11T08:00:00Z',
  status: 'ACTIVE',
  pumps: [{ id: 'AJ-TEST-0001', name: "Ramesh's pump", hp_rating: 5, status: 'STOPPED', lifecycle_state: 'ALLOCATED' }],
  qr: { state: 'PENDING', expires_at: '2026-12-10T08:00:00Z', claimed_at: null },
  ...over
});

beforeEach(() => {
  Object.values(mocks).forEach(m => typeof m === 'function' && (m as ReturnType<typeof vi.fn>).mockReset());
  mocks.role = 'manufacturer';
  mocks.fetchFarmers.mockResolvedValue({ farmers: [farmer()] });
});

describe('Farmers page', () => {
  it('lists each farmer with the pump and whether the QR was scanned, and has no Add farmer button', async () => {
    render(<FarmersView />);
    expect(await screen.findByText('Ramesh Patil')).toBeInTheDocument();
    expect(screen.getByText('AJ-TEST-0001 · 5 HP')).toBeInTheDocument();
    expect(screen.getByText('Waiting to be scanned')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add farmer/i })).not.toBeInTheDocument();
  });

  it('shows Farmer is using the app once the QR was scanned', async () => {
    mocks.fetchFarmers.mockResolvedValue({ farmers: [farmer({ qr: { state: 'CLAIMED', expires_at: null, claimed_at: '2026-11-11T09:00:00Z' } })] });
    render(<FarmersView />);
    expect(await screen.findByText('Farmer is using the app')).toBeInTheDocument();
  });

  it('lets the Ajanta admin edit, make a new QR, and stop a farmer', async () => {
    render(<FarmersView />);
    await screen.findByText('Ramesh Patil');
    expect(screen.getByRole('button', { name: /edit/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /new qr/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^stop$/i })).toBeEnabled();
  });

  it('asks before stopping a farmer, then stops them', async () => {
    mocks.deactivateFarmer.mockResolvedValue({ farmer: { id: 'f1' } });
    render(<FarmersView />);
    await userEvent.click(await screen.findByRole('button', { name: /^stop$/i }));
    expect(screen.getByText('Stop Ramesh Patil?')).toBeInTheDocument();
    expect(mocks.deactivateFarmer).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /stop access/i }));
    await waitFor(() => expect(mocks.deactivateFarmer).toHaveBeenCalledWith('f1'));
  });

  it('shows a stopped farmer as Stopped, with Restore instead of Stop and no new QR', async () => {
    mocks.fetchFarmers.mockResolvedValue({ farmers: [farmer({ status: 'SUSPENDED' })] });
    mocks.activateFarmer.mockResolvedValue({ farmer: { id: 'f1' } });
    render(<FarmersView />);
    expect(await screen.findByText('Stopped')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^stop$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new qr/i })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /restore/i }));
    await waitFor(() => expect(mocks.activateFarmer).toHaveBeenCalledWith('f1'));
  });

  it('saves only what was changed when a farmer is edited', async () => {
    mocks.updateFarmer.mockResolvedValue({ farmer: { id: 'f1' } });
    render(<FarmersView />);
    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));
    const name = await screen.findByLabelText(/farmer's name/i);
    await userEvent.clear(name);
    await userEvent.type(name, 'Ramesh S. Patil');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(mocks.updateFarmer).toHaveBeenCalledWith('f1', { full_name: 'Ramesh S. Patil' }));
  });

  it('refuses a mobile number that is not ten digits before it asks the server', async () => {
    render(<FarmersView />);
    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));
    const phone = await screen.findByLabelText(/mobile number/i);
    await userEvent.clear(phone);
    await userEvent.type(phone, '12345');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByText('Enter a 10-digit mobile number.')).toBeInTheDocument();
    expect(mocks.updateFarmer).not.toHaveBeenCalled();
  });

  it('is look-only for the super admin: a Monitoring only tag and no buttons', async () => {
    mocks.role = 'superadmin';
    render(<FarmersView />);
    expect(await screen.findByText('Ramesh Patil')).toBeInTheDocument();
    expect(screen.getByText('Monitoring only')).toBeInTheDocument();
    for (const name of [/edit/i, /new qr/i, /^stop$/i, /add farmer/i]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('says so when there are no farmers yet', async () => {
    mocks.fetchFarmers.mockResolvedValue({ farmers: [] });
    render(<FarmersView />);
    expect(await screen.findByText(/No farmers yet/)).toBeInTheDocument();
  });
});
