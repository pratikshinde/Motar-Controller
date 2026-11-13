import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ createPartnerByQr: vi.fn(), showToast: vi.fn(), role: 'manufacturer' }));

vi.mock('../../api/users', async importOriginal => ({ ...(await importOriginal<typeof import('../../api/users')>()), createPartnerByQr: mocks.createPartnerByQr }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', role: mocks.role } }) }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));

import { AddSubordinateDialog } from '../AddSubordinateDialog';

const created = {
  message: 'ok',
  user: { id: 'p1', full_name: 'Suresh Patil', phone_number: '+919876543210', role: 'distributor' },
  claim: { qr: 'AGP-CLAIM:abcdefghijklmnopqrstuvwxyz012345', token: 'abcdefghijklmnopqrstuvwxyz012345', expires_at: '2099-01-01T00:00:00Z' }
};

beforeEach(() => {
  mocks.createPartnerByQr.mockReset();
  mocks.showToast.mockReset();
  mocks.role = 'manufacturer';
});

describe('Add distributor or dealer', () => {
  it('asks for a name and a mobile number only: no password, no code', () => {
    render(<AddSubordinateDialog open onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/mobile number/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/whatsapp/i)).not.toBeInTheDocument();
  });

  it('creates the account and shows the one-time QR with the link to open it', async () => {
    mocks.createPartnerByQr.mockResolvedValue(created);
    const onCreated = vi.fn();
    render(<AddSubordinateDialog open onClose={vi.fn()} onCreated={onCreated} />);
    await userEvent.type(screen.getByLabelText(/full name/i), 'Suresh Patil');
    await userEvent.type(screen.getByLabelText(/mobile number/i), '98765 43210');
    await userEvent.click(screen.getByRole('button', { name: /add and show qr/i }));
    await waitFor(() => expect(mocks.createPartnerByQr).toHaveBeenCalledTimes(1));
    expect(mocks.createPartnerByQr.mock.calls[0][0]).toMatchObject({ full_name: 'Suresh Patil', phone_number: '98765 43210', role: 'distributor' });
    expect(await screen.findByTestId('partner-qr')).toBeInTheDocument();
    expect(screen.getByTestId('partner-qr-link')).toHaveTextContent(`/claim/${created.claim.token}`);
    expect(onCreated).toHaveBeenCalled();
  });

  it('offers distributor and dealer to an admin, and nothing at all to a dealer', async () => {
    const { unmount } = render(<AddSubordinateDialog open onClose={vi.fn()} onCreated={vi.fn()} />);
    await userEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByRole('option', { name: /regional distributor/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /dealer/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /farmer/i })).not.toBeInTheDocument();
    unmount();
    mocks.role = 'dealer';
    const { container } = render(<AddSubordinateDialog open onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('refuses a number that is not ten digits without asking the server', async () => {
    render(<AddSubordinateDialog open onClose={vi.fn()} onCreated={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/full name/i), 'Suresh Patil');
    await userEvent.type(screen.getByLabelText(/mobile number/i), '12345');
    await userEvent.click(screen.getByRole('button', { name: /add and show qr/i }));
    expect(mocks.createPartnerByQr).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith(expect.stringMatching(/10-digit/), true);
  });
});
