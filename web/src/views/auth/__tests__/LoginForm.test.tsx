import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  handleAuthResult: vi.fn(),
  showToast: vi.fn(),
  requestEmailCode: vi.fn(),
  loginWithEmailCode: vi.fn(),
  loginWithPassword: vi.fn(),
  verifyMfa: vi.fn(),
  clearSession: vi.fn(),
  navigate: vi.fn()
}));

vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ handleAuthResult: mocks.handleAuthResult }) }));
vi.mock('../../../context/ToastContext', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock('../../../api/auth', () => ({ requestEmailCode: mocks.requestEmailCode, loginWithEmailCode: mocks.loginWithEmailCode, loginWithPassword: mocks.loginWithPassword }));
vi.mock('../../../api/mfa', () => ({ verifyMfa: mocks.verifyMfa }));
vi.mock('../../../api/client', () => ({ clearSession: mocks.clearSession }));
vi.mock('react-router-dom', async importOriginal => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => mocks.navigate }));

import { LoginForm, type LoginVariant } from '../LoginForm';

const renderForm = (variant: LoginVariant) => render(<MemoryRouter><LoginForm variant={variant} /></MemoryRouter>);
const session = (role: string) => ({ user: { id: 'u1', full_name: 'Some Person', role }, access_token: 'a', refresh_token: 'r' });

async function askForTheCode(email = 'admin@ajanta.test') {
  await userEvent.type(screen.getByPlaceholderText('name@company.com'), email);
  await userEvent.click(screen.getByRole('button', { name: /send me a code/i }));
  await screen.findByTestId('code-sent');
}

async function typeTheCode(code: string) {
  const field = screen.getByPlaceholderText('123456');
  await userEvent.clear(field);
  await userEvent.type(field, code);
}

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockReset());
  mocks.requestEmailCode.mockResolvedValue(undefined);
});

describe('the platform owner sign-in: the emailed code, then the authenticator app', () => {
  it('is titled for the platform owner and goes back to the home page', async () => {
    renderForm('owner');
    expect(screen.getByText('Platform owner sign in')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('back-link'));
    expect(mocks.navigate).toHaveBeenCalledWith('/');
  });

  it('asks for the authenticator code after the emailed one, then signs in', async () => {
    mocks.loginWithEmailCode.mockResolvedValue({ mfa_required: true, mfa_token: 'temp-token' });
    mocks.verifyMfa.mockResolvedValue(session('superadmin'));
    renderForm('owner');
    await askForTheCode('owner@example.com');
    await typeTheCode('111222');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(await screen.findByText('Two-Factor Authentication')).toBeInTheDocument();
    expect(mocks.handleAuthResult).not.toHaveBeenCalled();
    const code = screen.getByLabelText('Authenticator Code');
    expect(code).toHaveValue('');
    await userEvent.type(code, '654321');
    await userEvent.click(screen.getByRole('button', { name: /verify code/i }));
    await waitFor(() => expect(mocks.verifyMfa).toHaveBeenCalledWith('temp-token', '654321'));
    await waitFor(() => expect(mocks.handleAuthResult).toHaveBeenCalledWith(session('superadmin')));
  });

  it('an admin\'s email is refused on the owner page, and no session is kept', async () => {
    mocks.loginWithEmailCode.mockResolvedValue(session('manufacturer'));
    renderForm('owner');
    await askForTheCode('admin@ajanta.test');
    await typeTheCode('111222');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByText(/not the platform owner/i)).toBeInTheDocument();
    expect(mocks.clearSession).toHaveBeenCalled();
    expect(mocks.handleAuthResult).not.toHaveBeenCalled();
  });
});

describe('distributors and dealers sign in with their mobile number and password', () => {
  it('a distributor signs in with the number and the password they chose', async () => {
    mocks.loginWithPassword.mockResolvedValue(session('distributor'));
    renderForm('distributor');
    expect(screen.getByText('Distributor sign in')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('name@company.com')).not.toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('98765 43210'), '9876543210');
    await userEvent.type(screen.getByPlaceholderText('Enter your password'), 'my-own-password');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    await waitFor(() => expect(mocks.loginWithPassword).toHaveBeenCalledWith('9876543210', 'my-own-password'));
    expect(mocks.requestEmailCode).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/dashboard'));
  });

  it('a dealer signs in the same way', async () => {
    mocks.loginWithPassword.mockResolvedValue(session('dealer'));
    renderForm('dealer');
    expect(screen.getByText('Dealer sign in')).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('98765 43210'), '9876543211');
    await userEvent.type(screen.getByPlaceholderText('Enter your password'), 'another-password');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    await waitFor(() => expect(mocks.handleAuthResult).toHaveBeenCalledWith(session('dealer')));
  });

  it('a dealer who chose Distributor is told, and no session is kept', async () => {
    mocks.loginWithPassword.mockResolvedValue(session('dealer'));
    renderForm('distributor');
    await userEvent.type(screen.getByPlaceholderText('98765 43210'), '9876543211');
    await userEvent.type(screen.getByPlaceholderText('Enter your password'), 'another-password');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByText(/not a distributor. Choose dealer/i)).toBeInTheDocument();
    expect(mocks.clearSession).toHaveBeenCalled();
    expect(mocks.handleAuthResult).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalledWith('/dashboard');
  });
});
