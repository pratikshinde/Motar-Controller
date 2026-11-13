import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  handleAuthResult: vi.fn(),
  showToast: vi.fn(),
  loginWithEmail: vi.fn(),
  loginWithPassword: vi.fn(),
  verifyMfa: vi.fn(),
  navigate: vi.fn()
}));

vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ handleAuthResult: mocks.handleAuthResult }) }));
vi.mock('../../../context/ToastContext', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock('../../../api/auth', () => ({ loginWithEmail: mocks.loginWithEmail, loginWithPassword: mocks.loginWithPassword }));
vi.mock('../../../api/mfa', () => ({ verifyMfa: mocks.verifyMfa }));
vi.mock('react-router-dom', async importOriginal => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => mocks.navigate }));

import { LoginForm } from '../LoginForm';

const renderForm = () => render(<MemoryRouter><LoginForm /></MemoryRouter>);
const session = { user: { id: 'u1', full_name: 'Ajanta Admin', role: 'manufacturer' }, access_token: 'a', refresh_token: 'r' };

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockReset());
});

describe('the website sign-in: email and password, or phone number and password', () => {
  it('asks for an email and a password by default, and offers no sign-up and no OTP', () => {
    renderForm();
    expect(screen.getByPlaceholderText('name@company.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument();
    for (const gone of [/create account/i, /sign in with otp/i, /forgot password\?/i]) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument();
    }
  });

  it('keeps the button off until both are filled', async () => {
    renderForm();
    const button = screen.getByRole('button', { name: /sign in/i });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText('name@company.com'), 'admin@ajanta.test');
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText('Enter your password'), 'a-password');
    expect(button).toBeEnabled();
  });

  it('signs in with the email and password and opens the dashboard', async () => {
    mocks.loginWithEmail.mockResolvedValue(session);
    renderForm();
    await userEvent.type(screen.getByPlaceholderText('name@company.com'), 'admin@ajanta.test');
    await userEvent.type(screen.getByPlaceholderText('Enter your password'), 'a-password');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(mocks.loginWithEmail).toHaveBeenCalledWith('admin@ajanta.test', 'a-password'));
    await waitFor(() => expect(mocks.handleAuthResult).toHaveBeenCalledWith(session));
    expect(mocks.navigate).toHaveBeenCalledWith('/dashboard');
  });

  it('shows the server\'s reason when the sign-in is refused, and stays on the form', async () => {
    mocks.loginWithEmail.mockRejectedValue(new Error('Incorrect email or password. Please check and try again.'));
    renderForm();
    await userEvent.type(screen.getByPlaceholderText('name@company.com'), 'admin@ajanta.test');
    await userEvent.type(screen.getByPlaceholderText('Enter your password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Incorrect email or password. Please check and try again.')).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.handleAuthResult).not.toHaveBeenCalled();
  });

  it('asks for the authenticator code when the account needs one, then signs in', async () => {
    mocks.loginWithEmail.mockResolvedValue({ mfa_required: true, mfa_token: 'temp-token' });
    mocks.verifyMfa.mockResolvedValue(session);
    renderForm();
    await userEvent.type(screen.getByPlaceholderText('name@company.com'), 'owner@example.com');
    await userEvent.type(screen.getByPlaceholderText('Enter your password'), 'a-password');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Two-Factor Authentication')).toBeInTheDocument();
    expect(mocks.handleAuthResult).not.toHaveBeenCalled();
    const code = screen.getByLabelText('Authenticator Code');
    await userEvent.clear(code);
    await userEvent.type(code, '654321');
    await userEvent.click(screen.getByRole('button', { name: /verify code/i }));
    await waitFor(() => expect(mocks.verifyMfa).toHaveBeenCalledWith('temp-token', '654321'));
    await waitFor(() => expect(mocks.handleAuthResult).toHaveBeenCalledWith(session));
  });
});

describe('distributors and dealers sign in with their mobile number', () => {
  it('switches to the mobile number and signs in with it and the password they chose', async () => {
    mocks.loginWithPassword.mockResolvedValue(session);
    renderForm();
    await userEvent.click(screen.getByTestId('switch-login'));
    expect(screen.queryByPlaceholderText('name@company.com')).not.toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('98765 43210'), '9876543210');
    await userEvent.type(screen.getByPlaceholderText('Enter your password'), 'my-own-password');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    await waitFor(() => expect(mocks.loginWithPassword).toHaveBeenCalledWith('9876543210', 'my-own-password'));
    expect(mocks.loginWithEmail).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/dashboard'));
  });

  it('switches back to the email', async () => {
    renderForm();
    await userEvent.click(screen.getByTestId('switch-login'));
    await userEvent.click(screen.getByTestId('switch-login'));
    expect(screen.getByPlaceholderText('name@company.com')).toBeInTheDocument();
  });
});
