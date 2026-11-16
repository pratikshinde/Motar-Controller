import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  fetchRemovalPreview: vi.fn(),
  suspendUserAccount: vi.fn(),
  reactivateUserAccount: vi.fn(),
  removeUserAccount: vi.fn(),
  showToast: vi.fn()
}));

vi.mock('../../api/users', () => ({
  fetchRemovalPreview: mocks.fetchRemovalPreview,
  suspendUserAccount: mocks.suspendUserAccount,
  reactivateUserAccount: mocks.reactivateUserAccount,
  removeUserAccount: mocks.removeUserAccount
}));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));

import { RemovePersonDialog } from '../RemovePersonDialog';

const preview = (over: any = {}) => ({
  id: 'u1', full_name: 'Suresh Patil', email: 'suresh@example.com', role: 'dealer', status: 'ACTIVE',
  beneath: { distributors: 0, dealers: 0, farmers: 0, other: 0, pumps: 0, accounts: 0 }, can_delete: true, blocked_reason: null, ...over
});
const target = { id: 'u1', name: 'Suresh Patil', label: 'dealer' };

function open(props: any = {}) {
  const onClose = vi.fn();
  const onRemoved = vi.fn();
  const onStatusChanged = vi.fn();
  render(<RemovePersonDialog target={target} onClose={onClose} onRemoved={onRemoved} onStatusChanged={onStatusChanged} {...props} />);
  return { onClose, onRemoved, onStatusChanged };
}

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockReset());
  mocks.fetchRemovalPreview.mockResolvedValue(preview());
});

describe('removing a person: nothing is filled in for you, and the confirmation depends on what is under them', () => {
  it('says what sits under them, so the owner knows what they are touching', async () => {
    mocks.fetchRemovalPreview.mockResolvedValue(preview({ role: 'manufacturer', full_name: 'Meera Joshi', beneath: { distributors: 4, dealers: 12, farmers: 230, other: 0, pumps: 310, accounts: 246 }, can_delete: false, blocked_reason: 'There are still people or pumps under them. Switch them off instead, or move or remove everyone under them first.' }));
    open({ target: { id: 'u1', name: 'Meera Joshi', label: 'admin' } });
    expect(await screen.findByText('4 Distributors')).toBeInTheDocument();
    expect(screen.getByText('12 Dealers')).toBeInTheDocument();
    expect(screen.getByText('230 Farmers')).toBeInTheDocument();
    expect(screen.getByText('310 Pumps')).toBeInTheDocument();
    expect(screen.getByText(/still people or pumps under them/i)).toBeInTheDocument();
  });

  it('offers no permanent removal at all while people or pumps are under them: only Switch off', async () => {
    mocks.fetchRemovalPreview.mockResolvedValue(preview({ beneath: { distributors: 0, dealers: 0, farmers: 3, other: 0, pumps: 5, accounts: 3 }, can_delete: false, blocked_reason: 'There are still people or pumps under them. Switch them off instead.' }));
    open();
    await screen.findByText('3 Farmers');
    expect(screen.queryByTestId('confirm-remove')).not.toBeInTheDocument();
    expect(screen.queryByTestId('remove-confirm-name-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('confirm-toggle-status')).toHaveTextContent('Switch off login');
  });

  it('starts with an empty reason and an empty name: one mistaken click removes nobody', async () => {
    open();
    await screen.findByText('0 Dealers');
    expect(screen.getByTestId('remove-reason-input')).toHaveValue('');
    expect(screen.getByTestId('remove-confirm-name-input')).toHaveValue('');
    expect(screen.getByTestId('confirm-remove')).toBeDisabled();
    expect(screen.getByTestId('confirm-toggle-status')).toBeDisabled();
  });

  it('needs a real reason and the name typed before Remove permanently turns on', async () => {
    open();
    await screen.findByText('0 Dealers');
    await userEvent.type(screen.getByTestId('remove-reason-input'), 'dup');
    await userEvent.type(screen.getByTestId('remove-confirm-name-input'), 'Suresh Patil');
    expect(screen.getByTestId('confirm-remove')).toBeDisabled();
    await userEvent.type(screen.getByTestId('remove-reason-input'), 'licate account');
    expect(screen.getByTestId('confirm-remove')).toBeEnabled();
    await userEvent.clear(screen.getByTestId('remove-confirm-name-input'));
    await userEvent.type(screen.getByTestId('remove-confirm-name-input'), 'Somebody Else');
    expect(screen.getByTestId('confirm-remove')).toBeDisabled();
  });

  it('removes them with the reason and the typed name, then tells the page', async () => {
    mocks.removeUserAccount.mockResolvedValue({ message: 'Removed', id: 'u1' });
    const { onRemoved } = open();
    await screen.findByText('0 Dealers');
    await userEvent.type(screen.getByTestId('remove-reason-input'), 'Registered by mistake');
    await userEvent.type(screen.getByTestId('remove-confirm-name-input'), 'suresh patil');
    await userEvent.click(screen.getByTestId('confirm-remove'));
    await waitFor(() => expect(mocks.removeUserAccount).toHaveBeenCalledWith('u1', 'Registered by mistake', 'suresh patil'));
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
  });

  it('picks a quick reason with one click', async () => {
    open();
    await screen.findByText('0 Dealers');
    await userEvent.click(screen.getByText('Left the company'));
    expect(screen.getByTestId('remove-reason-input')).toHaveValue('Left the company');
  });

  it('shows the server\'s reason when it refuses', async () => {
    mocks.removeUserAccount.mockRejectedValue(new Error('There are still people or pumps under them.'));
    const { onRemoved } = open();
    await screen.findByText('0 Dealers');
    await userEvent.type(screen.getByTestId('remove-reason-input'), 'Registered by mistake');
    await userEvent.type(screen.getByTestId('remove-confirm-name-input'), 'Suresh Patil');
    await userEvent.click(screen.getByTestId('confirm-remove'));
    expect(await screen.findByText(/still people or pumps under them/i)).toBeInTheDocument();
    expect(onRemoved).not.toHaveBeenCalled();
  });
});

describe('switching off and back on: reversible, and still needs a reason', () => {
  it('switches off with a reason and tells the page', async () => {
    mocks.suspendUserAccount.mockResolvedValue({ message: 'Switched off', id: 'u1' });
    const { onStatusChanged } = open();
    await screen.findByText('0 Dealers');
    await userEvent.type(screen.getByTestId('remove-reason-input'), 'Left the company');
    await userEvent.click(screen.getByTestId('confirm-toggle-status'));
    await waitFor(() => expect(mocks.suspendUserAccount).toHaveBeenCalledWith('u1', 'Left the company'));
    await waitFor(() => expect(onStatusChanged).toHaveBeenCalled());
  });

  it('offers to switch someone who is already off back on', async () => {
    mocks.fetchRemovalPreview.mockResolvedValue(preview({ status: 'SUSPENDED' }));
    mocks.reactivateUserAccount.mockResolvedValue({ message: 'Switched on', id: 'u1' });
    open();
    await screen.findByText(/Status: Switched off/);
    expect(screen.getByTestId('confirm-toggle-status')).toHaveTextContent('Switch back on');
    await userEvent.type(screen.getByTestId('remove-reason-input'), 'Back in business');
    await userEvent.click(screen.getByTestId('confirm-toggle-status'));
    await waitFor(() => expect(mocks.reactivateUserAccount).toHaveBeenCalledWith('u1', 'Back in business'));
  });

  it('shows why the account cannot be looked at when the server refuses (not below you)', async () => {
    mocks.fetchRemovalPreview.mockRejectedValue(new Error('You can only switch off or remove someone below you.'));
    open();
    expect(await screen.findByText(/only switch off or remove someone below you/i)).toBeInTheDocument();
    expect(screen.queryByTestId('confirm-remove')).not.toBeInTheDocument();
  });
});
