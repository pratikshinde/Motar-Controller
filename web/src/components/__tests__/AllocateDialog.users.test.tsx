import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ usersOnly: true, fetchUserTree: vi.fn(), bulkAllocatePumps: vi.fn() }));

vi.mock('../../hooks/useBrandRules', () => ({ useBrandRules: () => ({ loaded: true, usersOnly: mocks.usersOnly }) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'admin', role: 'manufacturer' } }) }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../api/users', async importOriginal => ({ ...(await importOriginal<typeof import('../../api/users')>()), fetchUserTree: mocks.fetchUserTree }));
vi.mock('../../api/pumps', async importOriginal => ({ ...(await importOriginal<typeof import('../../api/pumps')>()), bulkAllocatePumps: mocks.bulkAllocatePumps }));

import { AllocateDialog } from '../AllocateDialog';

const member = (id: string, role: string, name: string) => ({ id, role, full_name: name, phone_number: '+9199' + id });
const tree = [{ members: [member('1', 'customer', 'Ravi User'), member('2', 'distributor', 'Some Distributor'), member('3', 'dealer', 'Some Dealer')], children: [] }];

beforeEach(() => {
  mocks.usersOnly = true;
  mocks.fetchUserTree.mockReset();
  mocks.bulkAllocatePumps.mockReset();
  mocks.fetchUserTree.mockResolvedValue({ tree });
});

describe('Give a device', () => {
  it('offers users only, and talks about devices, when the admin has users only', async () => {
    render(<AllocateDialog open onClose={() => undefined} onAllocated={() => undefined} pumpIds={['862818041287022']} />);
    expect(await screen.findByText('Give 1 device')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByText(/Ravi User/)).toBeInTheDocument();
    expect(screen.queryByText(/Some Distributor/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Some Dealer/)).not.toBeInTheDocument();
  });

  it('keeps offering distributors and dealers in the other brands', async () => {
    mocks.usersOnly = false;
    render(<AllocateDialog open onClose={() => undefined} onAllocated={() => undefined} pumpIds={['S-1']} />);
    expect(await screen.findByText('Give 1 starter')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByText(/Some Distributor/)).toBeInTheDocument();
    expect(screen.queryByText(/Ravi User/)).not.toBeInTheDocument();
  });

  it('gives the device to the chosen user', async () => {
    mocks.bulkAllocatePumps.mockResolvedValue({ message: '1 of 1 device allocated', results: [{ pump_id: '862818041287022', success: true }] });
    render(<AllocateDialog open onClose={() => undefined} onAllocated={() => undefined} pumpIds={['862818041287022']} />);
    await userEvent.click(await screen.findByRole('combobox'));
    await userEvent.click(await screen.findByText(/Ravi User/));
    await userEvent.click(screen.getByRole('button', { name: /^give$|allocate|give device/i }));
    await waitFor(() => expect(mocks.bulkAllocatePumps).toHaveBeenCalledWith(['862818041287022'], '1', undefined));
  });
});
