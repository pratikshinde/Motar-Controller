import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  handleAuthResult: vi.fn(),
  showToast: vi.fn(),
  loginWithEmail: vi.fn(),
  setAdminPassword: vi.fn(),
  verifyMfa: vi.fn(),
  clearSession: vi.fn(),
  navigate: vi.fn()
}));

vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ handleAuthResult: mocks.handleAuthResult }) }));
vi.mock('../../../context/ToastContext', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock('../../../api/auth', () => ({ loginWithEmail: mocks.loginWithEmail, setAdminPassword: mocks.setAdminPassword }));
vi.mock('../../../api/mfa', () => ({ verifyMfa: mocks.verifyMfa }));
vi.mock('../../../api/client', () => ({ clearSession: mocks.clearSession }));
vi.mock('react-router-dom', async importOriginal => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => mocks.navigate }));

import { AdminLoginForm } from '../AdminLoginForm';

const renderForm = () => render(<MemoryRouter><AdminLoginForm /></MemoryRouter>);
const session = (role: string) => ({ user: { id: 'u1', full_name: 'Ajanta Admin', role }, access_token: 'a', refresh_token: 'r' });

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockReset());
});

describe('the admin sign-in: email and password', () => {
  it('asks for the email and the password the admin chose', () => {
    renderForm();
    expect(screen.getByText('Admin sign in')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('name@company.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeDisabled();
    expect(screen.queryByText(/create account/i)).not.toBeInTheDocument();
  });

  it('signs in with the email and the password and opens the dashboard', async () => {
    mocks.loginWithEmail.mockResolvedValue(session('manufacturer'));
    renderForm();
    await userEvent.type(screen.getByPlaceholderText('name@company.com'), 'admin@ajanta.test');
    await userEvent.type(screen.getByPlaceholderText('Enter your password'), 'my-own-long-pass-1');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    await waitFor(() => expect(mocks.loginWithEmail).toHaveBeenCalledWith('admin@ajanta.test', 'my-own-long-pass-1'));
    await waitFor(() => expect(mocks.handleAuthResult).toHaveBeenCalledWith(session('manufacturer')));
    expect(mocks.navigate).toHaveBeenCalledWith('/dashboard');
  });

  it('shows the server\'s reason when the sign-in is refused', async () => {
    mocks.loginWithEmail.mockRejectedValue(new Error('Incorrect email or password. Please check and try again.'));
    renderForm();
    await userEvent.type(screen.getByPlaceholderText('name@company.com'), 'admin@ajanta.test');
    await userEvent.type(screen.getByPlaceholderText('Enter your password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByText('Incorrect email or password. Please check and try again.')).toBeInTheDocument();
    expect(mocks.handleAuthResult).not.toHaveBeenCalled();
  });

  it('refuses the platform owner here and keeps no session', async () => {
    mocks.loginWithEmail.mockResolvedValue(session('superadmin'));
    renderForm();
    await userEvent.type(screen.getByPlaceholderText('name@company.com'), 'owner@example.com');
    await userEvent.type(screen.getByPlaceholderText('Enter your password'), 'some-long-password');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByText(/lock icon on the home page/i)).toBeInTheDocument();
    expect(mocks.clearSession).toHaveBeenCalled();
    expect(mocks.handleAuthResult).not.toHaveBeenCalled();
  });

  it('goes back to the choice of roles', async () => {
    renderForm();
    await userEvent.click(screen.getByTestId('back-link'));
    expect(mocks.navigate).toHaveBeenCalledWith('/login');
  });
});

describe('the first time: the email, the code that was emailed when the platform owner added them, and a password of their own', () => {
  async function openFirstTime() {
    await userEvent.click(screen.getByTestId('first-time'));
  }

  async function fill(email: string, code: string, password: string, again = password) {
    await userEvent.type(screen.getByPlaceholderText('name@company.com'), email);
    await userEvent.type(screen.getByPlaceholderText('123456'), code);
    await userEvent.type(screen.getByLabelText('New password'), password);
    await userEvent.type(screen.getByLabelText('New password again'), again);
    await userEvent.click(screen.getByRole('button', { name: /set password and sign in/i }));
  }

  it('asks for the email, the code and the new password: it does not email anything itself', async () => {
    renderForm();
    await openFirstTime();
    expect(screen.getByText('Set your password')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('name@company.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('123456')).toHaveValue('');
    expect(screen.queryByRole('button', { name: /send me a code/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set password and sign in/i })).toBeDisabled();
  });

  it('saves the password with the code and signs the admin in', async () => {
    mocks.setAdminPassword.mockResolvedValue(session('manufacturer'));
    renderForm();
    await openFirstTime();
    await fill('admin@ajanta.test', '654321', 'a-brand-new-password-1');
    await waitFor(() => expect(mocks.setAdminPassword).toHaveBeenCalledWith('admin@ajanta.test', '654321', 'a-brand-new-password-1'));
    await waitFor(() => expect(mocks.handleAuthResult).toHaveBeenCalledWith(session('manufacturer')));
    expect(mocks.navigate).toHaveBeenCalledWith('/dashboard');
  });

  it('does not ask the server when the password is too short or typed differently twice', async () => {
    renderForm();
    await openFirstTime();
    await fill('admin@ajanta.test', '654321', 'short');
    expect(await screen.findByText(/Choose a password of at least 10 characters\./i)).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('New password'));
    await userEvent.clear(screen.getByLabelText('New password again'));
    await userEvent.type(screen.getByLabelText('New password'), 'long-enough-password-1');
    await userEvent.type(screen.getByLabelText('New password again'), 'long-enough-password-2');
    await userEvent.click(screen.getByRole('button', { name: /set password and sign in/i }));
    expect(await screen.findByText(/not the same/i)).toBeInTheDocument();
    expect(mocks.setAdminPassword).not.toHaveBeenCalled();
  });

  it('shows the server\'s reason when the code is wrong, and stays on the form', async () => {
    mocks.setAdminPassword.mockRejectedValue(new Error('That code is not right, or it has expired. Ask the platform owner for a new one.'));
    renderForm();
    await openFirstTime();
    await fill('admin@ajanta.test', '000000', 'a-brand-new-password-1');
    expect(await screen.findByText(/Ask the platform owner for a new one/i)).toBeInTheDocument();
    expect(mocks.handleAuthResult).not.toHaveBeenCalled();
  });

  it('tells a forgetful admin to ask the platform owner for a new code: there is no self-service code', async () => {
    renderForm();
    expect(screen.getByText(/Ask the platform owner for a new code/i)).toBeInTheDocument();
    await openFirstTime();
    expect(screen.getByText(/Ask the platform owner to send you a new one/i)).toBeInTheDocument();
  });

  it('goes back to the password sign-in', async () => {
    renderForm();
    await openFirstTime();
    await userEvent.click(screen.getByTestId('back-link'));
    expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument();
  });
});

describe('an admin whose account also needs the authenticator', () => {
  it('asks for the authenticator code after the password, then signs in', async () => {
    mocks.loginWithEmail.mockResolvedValue({ mfa_required: true, mfa_token: 'temp-token' });
    mocks.verifyMfa.mockResolvedValue(session('manufacturer'));
    renderForm();
    await userEvent.type(screen.getByPlaceholderText('name@company.com'), 'admin@ajanta.test');
    await userEvent.type(screen.getByPlaceholderText('Enter your password'), 'my-own-long-pass-1');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByText('Two-Factor Authentication')).toBeInTheDocument();
    const code = screen.getByLabelText('Authenticator Code');
    expect(code).toHaveValue('');
    await userEvent.type(code, '654321');
    await userEvent.click(screen.getByRole('button', { name: /verify code/i }));
    await waitFor(() => expect(mocks.verifyMfa).toHaveBeenCalledWith('temp-token', '654321'));
    await waitFor(() => expect(mocks.handleAuthResult).toHaveBeenCalledWith(session('manufacturer')));
  });
});
