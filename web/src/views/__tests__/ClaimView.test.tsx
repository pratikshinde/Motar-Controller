import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

const mocks = vi.hoisted(() => ({ claimPartnerAccount: vi.fn(), handleAuthResult: vi.fn(), navigate: vi.fn() }));

vi.mock('../../api/auth', () => ({ claimPartnerAccount: mocks.claimPartnerAccount }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ handleAuthResult: mocks.handleAuthResult }) }));
vi.mock('react-router-dom', async importOriginal => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => mocks.navigate }));

import { ClaimView } from '../ClaimView';
import { buildAppTheme } from '../../theme';

const session = { user: { id: 'u1', full_name: 'Suresh Patil', role: 'dealer' }, access_token: 'a', refresh_token: 'r' };

function open() {
  return render(
    <ThemeProvider theme={buildAppTheme('light')}>
      <MemoryRouter initialEntries={['/claim/the-secret-from-the-qr']}>
        <Routes>
          <Route path="/claim/:token" element={<ClaimView />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );
}

async function fill(phone: string, password: string, again: string) {
  await userEvent.type(screen.getByLabelText(/your mobile number/i), phone);
  await userEvent.type(screen.getByLabelText(/choose a password/i), password);
  await userEvent.type(screen.getByLabelText(/type the password again/i), again);
}

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockReset());
});

describe('opening the account from the QR', () => {
  it('sends the secret from the link, the number and the new password, then signs in and opens the dashboard', async () => {
    mocks.claimPartnerAccount.mockResolvedValue(session);
    open();
    await fill('98765 43210', 'my-own-password', 'my-own-password');
    await userEvent.click(screen.getByRole('button', { name: /open my account/i }));
    await waitFor(() => expect(mocks.claimPartnerAccount).toHaveBeenCalledWith('the-secret-from-the-qr', '98765 43210', 'my-own-password'));
    await waitFor(() => expect(mocks.handleAuthResult).toHaveBeenCalledWith(session));
    expect(mocks.navigate).toHaveBeenCalledWith('/dashboard', { replace: true });
  });

  it('does not ask the server when the password is too short or typed differently twice', async () => {
    open();
    await fill('9876543210', 'short', 'short');
    await userEvent.click(screen.getByRole('button', { name: /open my account/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 8 characters/i);
    expect(mocks.claimPartnerAccount).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText(/choose a password/i));
    await userEvent.clear(screen.getByLabelText(/type the password again/i));
    await userEvent.type(screen.getByLabelText(/choose a password/i), 'long-enough-1');
    await userEvent.type(screen.getByLabelText(/type the password again/i), 'long-enough-2');
    await userEvent.click(screen.getByRole('button', { name: /open my account/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not the same/i);
    expect(mocks.claimPartnerAccount).not.toHaveBeenCalled();
  });

  it('shows the server\'s reason when the number is wrong, and stays on the page', async () => {
    mocks.claimPartnerAccount.mockRejectedValue(new Error('That number does not match the one registered for you.'));
    open();
    await fill('9000000000', 'my-own-password', 'my-own-password');
    await userEvent.click(screen.getByRole('button', { name: /open my account/i }));
    expect(await screen.findByText(/does not match the one registered/i)).toBeInTheDocument();
    expect(mocks.handleAuthResult).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
