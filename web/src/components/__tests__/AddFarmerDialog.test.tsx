import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ registerFarmer: vi.fn(), showToast: vi.fn() }));

vi.mock('../../api/farmers', () => ({ registerFarmer: mocks.registerFarmer }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock('../BarcodeScanDialog', () => ({ barcodeScanSupported: () => false, BarcodeScanDialog: () => null }));

import { AddFarmerDialog } from '../AddFarmerDialog';

const QR = 'AGP-CLAIM:abcdefghijklmnopqrstuvwxyz012345';
const registered = {
  message: 'Farmer registered',
  farmer: { id: 'f1', full_name: 'Ramesh Patil', phone_number: '+919876501234', address: 'Plot 12, Hadapsar, Pune' },
  pump: { id: 'AJ-TEST-0001', name: "Ramesh's pump", hp_rating: 5, status: 'STOPPED', lifecycle_state: 'ALLOCATED' },
  qr: { state: 'PENDING', expires_at: '2026-12-10T08:00:00Z', claimed_at: null, payload: QR }
};

async function fill(over: Partial<Record<'name' | 'address' | 'phone' | 'starter' | 'hp', string>> = {}) {
  const v = { name: 'Ramesh Patil', address: 'Plot 12, Hadapsar, Pune', phone: '98765 01234', starter: 'AJ-TEST-0001', hp: '5', ...over };
  await userEvent.type(screen.getByLabelText(/farmer's name/i), v.name);
  await userEvent.type(screen.getByLabelText(/^address/i), v.address);
  await userEvent.type(screen.getByLabelText(/mobile number/i), v.phone);
  await userEvent.type(screen.getByLabelText(/starter id/i), v.starter);
  await userEvent.type(screen.getByLabelText(/pump capacity/i), v.hp);
}

beforeEach(() => {
  mocks.registerFarmer.mockReset();
  mocks.showToast.mockReset();
});

describe('Add farmer', () => {
  const open = (onRegistered = vi.fn()) => render(<AddFarmerDialog open onClose={vi.fn()} onRegistered={onRegistered} />);

  it('sends the farmer, the starter and the capacity in one request and shows the QR', async () => {
    mocks.registerFarmer.mockResolvedValue(registered);
    const onRegistered = vi.fn();
    open(onRegistered);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: /register farmer/i }));
    await waitFor(() =>
      expect(mocks.registerFarmer).toHaveBeenCalledWith({
        full_name: 'Ramesh Patil',
        address: 'Plot 12, Hadapsar, Pune',
        phone: '9876501234',
        starter_id: 'AJ-TEST-0001',
        capacity_hp: 5
      })
    );
    expect(await screen.findByText('Farmer registered')).toBeInTheDocument();
    expect(screen.getByTestId('farmer-qr')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /print/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download png/i })).toBeInTheDocument();
    expect(onRegistered).toHaveBeenCalledTimes(1);
  });

  it('refuses a mobile number that is not ten digits, without asking the server', async () => {
    open();
    await fill({ phone: '12345' });
    await userEvent.click(screen.getByRole('button', { name: /register farmer/i }));
    expect(await screen.findByText('Enter a 10-digit mobile number.')).toBeInTheDocument();
    expect(mocks.registerFarmer).not.toHaveBeenCalled();
  });

  it('refuses a capacity that is not a positive number', async () => {
    open();
    await fill({ hp: '0' });
    await userEvent.click(screen.getByRole('button', { name: /register farmer/i }));
    expect(await screen.findByText('Enter the pump capacity in HP.')).toBeInTheDocument();
    expect(mocks.registerFarmer).not.toHaveBeenCalled();
  });

  it('shows the server\'s reason when the starter is not in stock, and keeps what was typed', async () => {
    mocks.registerFarmer.mockRejectedValue(new Error('That starter was not found in your stock. Check the barcode on the box.'));
    open();
    await fill({ starter: 'NOT-A-STARTER' });
    await userEvent.click(screen.getByRole('button', { name: /register farmer/i }));
    expect(await screen.findByText('That starter was not found in your stock. Check the barcode on the box.')).toBeInTheDocument();
    expect(screen.getByLabelText(/starter id/i)).toHaveValue('NOT-A-STARTER');
    expect(screen.queryByTestId('farmer-qr')).not.toBeInTheDocument();
  });

  it('does not submit when a barcode scanner presses Enter in the starter field', async () => {
    open();
    await fill();
    await userEvent.type(screen.getByLabelText(/starter id/i), '{Enter}');
    expect(mocks.registerFarmer).not.toHaveBeenCalled();
  });
});
