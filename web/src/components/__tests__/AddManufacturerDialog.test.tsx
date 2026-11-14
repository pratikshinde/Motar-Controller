import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  startAdminInvite: vi.fn(),
  verifyAdminInvite: vi.fn(),
  resendAdminInvite: vi.fn(),
  showToast: vi.fn()
}));

vi.mock('../../api/adminInvites', () => ({ startAdminInvite: mocks.startAdminInvite, verifyAdminInvite: mocks.verifyAdminInvite, resendAdminInvite: mocks.resendAdminInvite }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));

import { AddManufacturerDialog } from '../AddManufacturerDialog';

const invite = {
  id: 'inv1', full_name: 'Meera Joshi', company_name: 'Swati Pumps Pvt Ltd', address: 'Hadapsar, Pune', phone: '+919876543210', email: 'meera@swati.test',
  brand: null, status: 'WAITING_FOR_CODE', created_at: null, expires_at: null, user_id: null
};

const open = (props: any = {}) => render(<AddManufacturerDialog open onClose={vi.fn()} onCreated={vi.fn()} {...props} />);

async function fill(phone = '98765 43210') {
  await userEvent.type(screen.getByLabelText(/^admin name/i), 'Meera Joshi');
  await userEvent.type(screen.getByLabelText(/^company name/i), 'Swati Pumps Pvt Ltd');
  await userEvent.type(screen.getByLabelText(/^address/i), 'Hadapsar, Pune');
  await userEvent.type(screen.getByLabelText(/^phone number/i), phone);
  await userEvent.type(screen.getByLabelText(/^email/i), 'meera@swati.test');
}

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockReset());
  mocks.startAdminInvite.mockResolvedValue({ invite });
});

describe('registering an admin: five details, Verify email, the code the admin read out', () => {
  it('asks for exactly the admin name, company, address, phone and email: nothing else, and no password', () => {
    open();
    for (const label of [/^admin name/i, /^company name/i, /^address/i, /^phone number/i, /^email/i]) expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/short key|colour|support/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole('textbox')).toHaveLength(5);
  });

  it('shows the fixed +91 in front of the phone number', () => {
    open();
    expect(screen.getByText('+91')).toBeInTheDocument();
  });

  it('has a Verify email button below the fields, and no account is claimed to exist yet', async () => {
    open();
    await fill();
    await userEvent.click(screen.getByTestId('verify-email'));
    await waitFor(() => expect(mocks.startAdminInvite).toHaveBeenCalledWith({ full_name: 'Meera Joshi', company_name: 'Swati Pumps Pvt Ltd', address: 'Hadapsar, Pune', phone: '9876543210', email: 'meera@swati.test' }));
    expect(await screen.findByTestId('code-sent')).toHaveTextContent('meera@swati.test');
    expect(screen.queryByTestId('admin-added')).not.toBeInTheDocument();
  });

  it('does not ask the server for a phone number that is not ten digits', async () => {
    open();
    await fill('12345');
    await userEvent.click(screen.getByTestId('verify-email'));
    expect(await screen.findByText(/10-digit phone number/i)).toBeInTheDocument();
    expect(mocks.startAdminInvite).not.toHaveBeenCalled();
  });

  it('keeps Confirm off until six digits are typed, then registers the admin and tells the owner what the admin does next', async () => {
    mocks.verifyAdminInvite.mockResolvedValue({ invite: { ...invite, brand: 'swati' }, user: { id: 'u1', full_name: 'Meera Joshi', email: 'meera@swati.test' } });
    const onCreated = vi.fn();
    open({ onCreated });
    await fill();
    await userEvent.click(screen.getByTestId('verify-email'));
    await screen.findByTestId('code-sent');
    const confirm = screen.getByRole('button', { name: /confirm and register/i });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Code the admin read out'), '123456');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(mocks.verifyAdminInvite).toHaveBeenCalledWith('inv1', '123456'));
    const added = await screen.findByTestId('admin-added');
    expect(added).toHaveTextContent('Swati Pumps Pvt Ltd');
    expect(added).toHaveTextContent('First time here');
    expect(added).toHaveTextContent('meera@swati.test');
    expect(added).toHaveTextContent('never needed again');
  });

  it('says why when the code is wrong and stays on the code step', async () => {
    mocks.verifyAdminInvite.mockRejectedValue(new Error('That code is not right, or it has expired. Ask the platform owner for a new one.'));
    open();
    await fill();
    await userEvent.click(screen.getByTestId('verify-email'));
    await screen.findByTestId('code-sent');
    await userEvent.type(screen.getByLabelText('Code the admin read out'), '000000');
    await userEvent.click(screen.getByRole('button', { name: /confirm and register/i }));
    expect(await screen.findByText(/not right, or it has expired/i)).toBeInTheDocument();
    expect(screen.queryByTestId('admin-added')).not.toBeInTheDocument();
  });

  it('sends a new code when asked', async () => {
    mocks.resendAdminInvite.mockResolvedValue({ invite });
    open();
    await fill();
    await userEvent.click(screen.getByTestId('verify-email'));
    await screen.findByTestId('code-sent');
    await userEvent.click(screen.getByTestId('send-again'));
    await waitFor(() => expect(mocks.resendAdminInvite).toHaveBeenCalledWith('inv1'));
  });

  it('tells the owner when the email could not be sent, and lets them try again', async () => {
    mocks.startAdminInvite.mockRejectedValueOnce(new Error('The code could not be emailed. Check the email settings on the server and try again.'));
    open();
    await fill();
    await userEvent.click(screen.getByTestId('verify-email'));
    expect(await screen.findByText(/could not be emailed/i)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('verify-email'));
    await waitFor(() => expect(mocks.startAdminInvite).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('code-sent')).toBeInTheDocument();
  });
});
