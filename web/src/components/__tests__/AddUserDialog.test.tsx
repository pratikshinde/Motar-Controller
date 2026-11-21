import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ createSubordinateUser: vi.fn() }));
vi.mock('../../api/users', () => ({ createSubordinateUser: mocks.createSubordinateUser }));

import { AddUserDialog } from '../AddUserDialog';

const fill = async (name: string, phone: string, password: string) => {
  await userEvent.type(screen.getByLabelText(/^name/i), name);
  await userEvent.type(screen.getByLabelText(/mobile number/i), phone);
  await userEvent.type(screen.getByLabelText(/^password/i), password);
};

beforeEach(() => {
  mocks.createSubordinateUser.mockReset();
});

describe('adding a user with a mobile number and a password', () => {
  it('creates a customer and shows the sign-in details once', async () => {
    mocks.createSubordinateUser.mockResolvedValue({ message: 'ok', user: {} });
    const onCreated = vi.fn();
    render(<AddUserDialog open onClose={() => undefined} onCreated={onCreated} />);
    await fill('Ravi Kumar', '98765 43210', 'Sun-power-1');
    await userEvent.click(screen.getByRole('button', { name: /^add user$/i }));
    await waitFor(() => expect(mocks.createSubordinateUser).toHaveBeenCalledWith({ full_name: 'Ravi Kumar', phone_number: '9876543210', role: 'customer', password: 'Sun-power-1' }));
    expect(await screen.findByTestId('user-added')).toHaveTextContent('9876543210');
    expect(onCreated).toHaveBeenCalled();
  });

  it('does not ask the server for a bad number or a short password', async () => {
    render(<AddUserDialog open onClose={() => undefined} onCreated={() => undefined} />);
    await fill('Ravi Kumar', '12345', 'Sun-power-1');
    await userEvent.click(screen.getByRole('button', { name: /^add user$/i }));
    expect(await screen.findByText(/10-digit mobile/i)).toBeInTheDocument();
    expect(mocks.createSubordinateUser).not.toHaveBeenCalled();
  });

  it('shows the server reason, for example a number that is already registered', async () => {
    mocks.createSubordinateUser.mockRejectedValue(new Error('That phone number or email is already registered.'));
    render(<AddUserDialog open onClose={() => undefined} onCreated={() => undefined} />);
    await fill('Ravi Kumar', '9876543210', 'Sun-power-1');
    await userEvent.click(screen.getByRole('button', { name: /^add user$/i }));
    expect(await screen.findByText(/already registered/i)).toBeInTheDocument();
  });
});
