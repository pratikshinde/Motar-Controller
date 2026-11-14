import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  startRegistration: vi.fn(),
  fetchRegistration: vi.fn(),
  newRegistrationQr: vi.fn(),
  cancelRegistration: vi.fn(),
  showToast: vi.fn(),
  role: 'manufacturer'
}));

vi.mock('../../api/registrations', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/registrations')>()),
  startRegistration: mocks.startRegistration,
  fetchRegistration: mocks.fetchRegistration,
  newRegistrationQr: mocks.newRegistrationQr,
  cancelRegistration: mocks.cancelRegistration
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', role: mocks.role } }) }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));

import { AddSubordinateDialog } from '../AddSubordinateDialog';

const reg = (over: any = {}) => ({
  id: 'r1', role: 'distributor', full_name: 'Suresh Patil', address: 'Hadapsar, Pune', phone_number: '+919876543210', status: 'WAITING',
  created_at: '2026-11-13T10:00:00Z', expires_at: '2099-01-01T00:00:00Z', scanned_at: null, ...over
});
const started = { registration: reg(), qr: { token: 'abcdefghijklmnopqrstuvwxyz012345', expires_at: '2099-01-01T00:00:00Z' } };

async function fill(phone = '98765 43210') {
  await userEvent.type(screen.getByLabelText(/full name/i), 'Suresh Patil');
  await userEvent.type(screen.getByLabelText(/address/i), 'Hadapsar, Pune');
  await userEvent.type(screen.getByLabelText(/mobile number/i), phone);
  await userEvent.click(screen.getByRole('button', { name: /continue/i }));
}

const open = (props: any = {}) => render(<AddSubordinateDialog open onClose={vi.fn()} onCreated={vi.fn()} pollMs={20} {...props} />);

beforeEach(() => {
  Object.values(mocks).forEach(m => typeof m === 'function' && (m as ReturnType<typeof vi.fn>).mockReset());
  mocks.role = 'manufacturer';
  mocks.fetchRegistration.mockResolvedValue({ registration: reg() });
});

describe('Registering a distributor or a dealer: the form', () => {
  it('asks for name, address and mobile number only: no password, no code', () => {
    open();
    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/mobile number/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/whatsapp/i)).not.toBeInTheDocument();
  });

  it('refuses a number that is not ten digits, and a missing address, without asking the server', async () => {
    open();
    await userEvent.type(screen.getByLabelText(/full name/i), 'Suresh Patil');
    await userEvent.type(screen.getByLabelText(/mobile number/i), '12345');
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(mocks.startRegistration).not.toHaveBeenCalled();
  });

  it('offers distributor and dealer to an admin, and nothing at all to a dealer', async () => {
    const { unmount } = open();
    await userEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByRole('option', { name: /regional distributor/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /farmer/i })).not.toBeInTheDocument();
    unmount();
    mocks.role = 'dealer';
    const { container } = open();
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Registering: the QR, the scan, then their own password', () => {
  it('sends what was typed, the parent, and then shows the QR and waits for the scan: no account is claimed to exist', async () => {
    mocks.startRegistration.mockResolvedValue(started);
    const onCreated = vi.fn();
    open({ onCreated, underRole: 'distributor', lockRole: true, parentId: 'p9' });
    await fill();
    await waitFor(() => expect(mocks.startRegistration).toHaveBeenCalledTimes(1));
    expect(mocks.startRegistration.mock.calls[0][0]).toMatchObject({ full_name: 'Suresh Patil', address: 'Hadapsar, Pune', phone_number: '98765 43210', role: 'distributor', parent_user_id: 'p9' });
    expect(await screen.findByTestId('registration-link')).toHaveTextContent('/register/abcdefghijklmnopqrstuvwxyz012345');
    expect(screen.getByTestId('waiting-for-scan')).toHaveTextContent('scan this QR');
    expect(screen.queryByText(/send them/i)).not.toBeInTheDocument();
  });

  it('says it was scanned and that they are choosing a password: nothing for the admin to send', async () => {
    mocks.startRegistration.mockResolvedValue(started);
    mocks.fetchRegistration.mockResolvedValue({ registration: reg({ status: 'SCANNED' }) });
    open({ underRole: 'distributor', lockRole: true });
    await fill();
    expect(await screen.findByTestId('scanned')).toHaveTextContent('is choosing a password');
    expect(screen.queryByTestId('one-time-password')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new password/i })).not.toBeInTheDocument();
  });

  it('says it is registered when they have finished, with no pumps yet, and tells the page', async () => {
    mocks.startRegistration.mockResolvedValue(started);
    mocks.fetchRegistration.mockResolvedValue({ registration: reg({ status: 'COMPLETED' }) });
    const onCreated = vi.fn();
    open({ onCreated, underRole: 'distributor', lockRole: true });
    await fill();
    expect(await screen.findByText('Suresh Patil is registered')).toBeInTheDocument();
    expect(screen.getByText(/no pumps yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument();
    await waitFor(() => expect(onCreated.mock.calls.length).toBeGreaterThanOrEqual(2)); // once when started, once when finished
  });

  it('offers a new QR when it has expired or been blocked', async () => {
    mocks.startRegistration.mockResolvedValue(started);
    mocks.fetchRegistration.mockResolvedValue({ registration: reg({ status: 'BLOCKED' }) });
    mocks.newRegistrationQr.mockResolvedValue({ registration: reg(), qr: { token: 'zyxwvutsrqponmlkjihgfedcba98765', expires_at: '2099-01-01T00:00:00Z' } });
    open({ underRole: 'distributor', lockRole: true });
    await fill();
    expect(await screen.findByText(/too many wrong tries/i)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('new-qr-button'));
    await waitFor(() => expect(mocks.newRegistrationQr).toHaveBeenCalledWith('r1'));
  });

  it('cancels the registration when asked, so nothing is left behind', async () => {
    mocks.startRegistration.mockResolvedValue(started);
    mocks.cancelRegistration.mockResolvedValue({ message: 'ok' });
    const onClose = vi.fn();
    open({ onClose, underRole: 'distributor', lockRole: true });
    await fill();
    await userEvent.click(await screen.findByRole('button', { name: /cancel registration/i }));
    await waitFor(() => expect(mocks.cancelRegistration).toHaveBeenCalledWith('r1'));
    expect(onClose).toHaveBeenCalled();
  });

  it('carries on with an unfinished registration by making a new QR for it', async () => {
    mocks.newRegistrationQr.mockResolvedValue({ registration: reg(), qr: { token: 'resumedtokenresumedtoken1234', expires_at: '2099-01-01T00:00:00Z' } });
    open({ resume: reg() as any });
    await waitFor(() => expect(mocks.newRegistrationQr).toHaveBeenCalledWith('r1'));
    expect(await screen.findByTestId('registration-link')).toHaveTextContent('/register/resumedtokenresumedtoken1234');
  });
});
