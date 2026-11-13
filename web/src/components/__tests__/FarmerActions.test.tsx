import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FarmerRow } from '../../api/farmers';

const mocks = vi.hoisted(() => ({ showToast: vi.fn(), newFarmerQr: vi.fn(), updateFarmer: vi.fn(), deactivateFarmer: vi.fn(), activateFarmer: vi.fn() }));

vi.mock('../../hooks/useBrandName', () => ({ useBrandName: () => 'Ajanta Pump Controller', PLATFORM_NAME: 'Pump Controller' }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock('../../api/farmers', () => ({
  newFarmerQr: mocks.newFarmerQr,
  updateFarmer: mocks.updateFarmer,
  deactivateFarmer: mocks.deactivateFarmer,
  activateFarmer: mocks.activateFarmer
}));

import { FarmerActions } from '../people/FarmerActions';

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
  Object.values(mocks).forEach(m => m.mockReset());
});

describe('what can be done to one farmer', () => {
  it('offers edit, a new QR, and stop', () => {
    render(<FarmerActions farmer={farmer()} onChanged={vi.fn()} />);
    expect(screen.getByRole('button', { name: /edit/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /new qr/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^stop$/i })).toBeEnabled();
  });

  it('asks before stopping a farmer, then stops them and tells the page', async () => {
    mocks.deactivateFarmer.mockResolvedValue({ farmer: { id: 'f1' } });
    const onChanged = vi.fn();
    render(<FarmerActions farmer={farmer()} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('button', { name: /^stop$/i }));
    expect(screen.getByText('Stop Ramesh Patil?')).toBeInTheDocument();
    expect(mocks.deactivateFarmer).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /stop access/i }));
    await waitFor(() => expect(mocks.deactivateFarmer).toHaveBeenCalledWith('f1'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows Restore instead of Stop for a stopped farmer, and no new QR', async () => {
    mocks.activateFarmer.mockResolvedValue({ farmer: { id: 'f1' } });
    render(<FarmerActions farmer={farmer({ status: 'SUSPENDED' })} onChanged={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /^stop$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new qr/i })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /restore/i }));
    await waitFor(() => expect(mocks.activateFarmer).toHaveBeenCalledWith('f1'));
  });

  it('makes a new QR and shows it once', async () => {
    mocks.newFarmerQr.mockResolvedValue({
      message: 'ok',
      farmer: { id: 'f1', full_name: 'Ramesh Patil', phone_number: '+919876501234', address: null },
      qr: { state: 'PENDING', expires_at: '2026-12-10T08:00:00Z', claimed_at: null, payload: 'AGP-CLAIM:abcdefghijklmnopqrstuvwxyz012345' }
    });
    render(<FarmerActions farmer={farmer()} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /new qr/i }));
    expect(await screen.findByTestId('farmer-qr')).toBeInTheDocument();
    expect(screen.getByText('The earlier QR no longer works.')).toBeInTheDocument();
  });

  it('saves only what was changed when the farmer is edited', async () => {
    mocks.updateFarmer.mockResolvedValue({ farmer: { id: 'f1' } });
    render(<FarmerActions farmer={farmer()} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    const name = await screen.findByLabelText(/farmer's name/i);
    await userEvent.clear(name);
    await userEvent.type(name, 'Ramesh S. Patil');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(mocks.updateFarmer).toHaveBeenCalledWith('f1', { full_name: 'Ramesh S. Patil' }));
  });

  it('refuses a mobile number that is not ten digits before it asks the server', async () => {
    render(<FarmerActions farmer={farmer()} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    const phone = await screen.findByLabelText(/mobile number/i);
    await userEvent.clear(phone);
    await userEvent.type(phone, '12345');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByText('Enter a 10-digit mobile number.')).toBeInTheDocument();
    expect(mocks.updateFarmer).not.toHaveBeenCalled();
  });
});
