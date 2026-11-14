import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

const mocks = vi.hoisted(() => ({ scanRegistration: vi.fn(), completeRegistration: vi.fn(), handleAuthResult: vi.fn(), navigate: vi.fn() }));

vi.mock('../../api/registrations', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/registrations')>()),
  scanRegistration: mocks.scanRegistration,
  completeRegistration: mocks.completeRegistration
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ handleAuthResult: mocks.handleAuthResult }) }));
vi.mock('react-router-dom', async importOriginal => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => mocks.navigate }));

import { RegisterView } from '../RegisterView';
import { buildAppTheme } from '../../theme';

const session = { user: { id: 'u1', full_name: 'Suresh Patil', role: 'dealer' }, access_token: 'a', refresh_token: 'r' };
const greeting = { first_name: 'Suresh', role: 'dealer', registered_by: 'Ajanta Admin', brand: 'Ajanta Pump Controller' };

const open = () =>
  render(
    <ThemeProvider theme={buildAppTheme('light')}>
      <MemoryRouter initialEntries={['/register/the-secret-in-the-qr-code']}>
        <Routes>
          <Route path="/register/:token" element={<RegisterView />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );

async function fill(phone: string, password: string, again = password) {
  await userEvent.type(await screen.findByLabelText(/your mobile number/i), phone);
  await userEvent.type(screen.getByLabelText(/choose a password/i), password);
  await userEvent.type(screen.getByLabelText(/type the password again/i), again);
  await userEvent.click(screen.getByRole('button', { name: /finish registration/i }));
}

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockReset());
  mocks.scanRegistration.mockResolvedValue(greeting);
});

describe('the page the registration QR opens', () => {
  it('counts as the scan, and greets the person by who is registering them', async () => {
    open();
    expect(await screen.findByText('Hello Suresh')).toBeInTheDocument();
    expect(mocks.scanRegistration).toHaveBeenCalledWith('the-secret-in-the-qr-code');
    expect(screen.getByText(/Ajanta Admin is registering you as a dealer for Ajanta Pump Controller/)).toBeInTheDocument();
  });

  it('asks only for the mobile number and a password of their own: nothing was sent to them', async () => {
    open();
    expect(await screen.findByLabelText(/your mobile number/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/choose a password/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/the password you were sent/i)).not.toBeInTheDocument();
  });

  it('creates the account with the number and the chosen password, signs them in and opens the dashboard', async () => {
    mocks.completeRegistration.mockResolvedValue(session);
    open();
    await fill('98765 43210', 'my-own-password');
    await waitFor(() => expect(mocks.completeRegistration).toHaveBeenCalledWith('the-secret-in-the-qr-code', '98765 43210', 'my-own-password'));
    await waitFor(() => expect(mocks.handleAuthResult).toHaveBeenCalledWith(session));
    expect(mocks.navigate).toHaveBeenCalledWith('/dashboard', { replace: true });
  });

  it('says why, and stays on the form, when the number is not the one they were registered with', async () => {
    mocks.completeRegistration.mockRejectedValue(new Error('That is not the mobile number you were registered with.'));
    open();
    await fill('9000000000', 'my-own-password');
    expect(await screen.findByText('That is not the mobile number you were registered with.')).toBeInTheDocument();
    expect(mocks.handleAuthResult).not.toHaveBeenCalled();
  });

  it('does not ask the server when the new password is too short or typed differently twice', async () => {
    open();
    await fill('9876543210', 'short');
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 8 characters/i);
    await userEvent.clear(screen.getByLabelText(/choose a password/i));
    await userEvent.clear(screen.getByLabelText(/type the password again/i));
    await userEvent.type(screen.getByLabelText(/choose a password/i), 'long-enough-1');
    await userEvent.type(screen.getByLabelText(/type the password again/i), 'long-enough-2');
    await userEvent.click(screen.getByRole('button', { name: /finish registration/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not the same/i);
    expect(mocks.completeRegistration).not.toHaveBeenCalled();
  });

  it('says plainly that a link that has stopped working has stopped working, with no form', async () => {
    mocks.scanRegistration.mockRejectedValue(new Error('This link is not valid any more. Please ask the person who is registering you for a new QR code.'));
    open();
    expect(await screen.findByTestId('link-error')).toHaveTextContent('not valid any more');
    expect(screen.queryByLabelText(/your mobile number/i)).not.toBeInTheDocument();
  });
});
