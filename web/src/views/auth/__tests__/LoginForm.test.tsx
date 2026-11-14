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
  navigate: vi.fn()
}));

vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ handleAuthResult: mocks.handleAuthResult }) }));
vi.mock('../../../context/ToastContext', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock('../../../api/auth', () => ({ requestEmailCode: mocks.requestEmailCode, loginWithEmailCode: mocks.loginWithEmailCode, loginWithPassword: mocks.loginWithPassword }));
vi.mock('../../../api/mfa', () => ({ verifyMfa: mocks.verifyMfa }));
vi.mock('react-router-dom', async importOriginal => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => mocks.navigate }));

import { LoginForm } from '../LoginForm';

const renderForm = () => render(<MemoryRouter><LoginForm /></MemoryRouter>);
const session = { user: { id: 'u1', full_name: 'Ajanta Admin', role: 'manufacturer' }, access_token: 'a', refresh_token: 'r' };

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

describe('the admin and platform-owner sign-in: an email, then the code that was emailed', () => {
  it('asks for the email only: no password, no sign-up', () => {
    renderForm();
    expect(screen.getByPlaceholderText('name@company.com')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enter your password')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send me a code/i })).toBeDisabled();
    for (const gone of [/create account/i, /sign in with otp/i, /forgot password\?/i]) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument();
    }
  });

  it('emails the code, then asks for it', async () => {
    renderForm();
    await askForTheCode();
    expect(mocks.requestEmailCode).toHaveBeenCalledWith('admin@ajanta.test');
    expect(screen.getByTestId('code-sent')).toHaveTextContent('admin@ajanta.test');
    expect(screen.getByPlaceholderText('123456')).toHaveValue('');
    expect(screen.queryByText(/dev testing/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeDisabled();
  });

  it('signs in with the email and the code and opens the dashboard', async () => {
    mocks.loginWithEmailCode.mockResolvedValue(session);
    renderForm();
    await askForTheCode();
    await typeTheCode('654321');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    await waitFor(() => expect(mocks.loginWithEmailCode).toHaveBeenCalledWith('admin@ajanta.test', '654321'));
    await waitFor(() => expect(mocks.handleAuthResult).toHaveBeenCalledWith(session));
    expect(mocks.navigate).toHaveBeenCalledWith('/dashboard');
  });

  it('keeps Sign In off until the code has six digits', async () => {
    renderForm();
    await askForTheCode();
    await typeTheCode('123');
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeDisabled();
    await typeTheCode('123456');
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeEnabled();
  });

  it('shows the server\'s reason when the code is refused, and stays on the form', async () => {
    mocks.loginWithEmailCode.mockRejectedValue(new Error('That code is not right, or it has expired. Ask for a new one.'));
    renderForm();
    await askForTheCode();
    await typeTheCode('000000');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByText('That code is not right, or it has expired. Ask for a new one.')).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.handleAuthResult).not.toHaveBeenCalled();
  });

  it('changing the email asks for a new code', async () => {
    renderForm();
    await askForTheCode();
    await userEvent.type(screen.getByPlaceholderText('name@company.com'), 'x');
    expect(screen.queryByTestId('code-sent')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send me a code/i })).toBeEnabled();
  });

  it('asks for the authenticator code after the emailed one when the account needs it (the platform owner), then signs in', async () => {
    mocks.loginWithEmailCode.mockResolvedValue({ mfa_required: true, mfa_token: 'temp-token' });
    mocks.verifyMfa.mockResolvedValue(session);
    renderForm();
    await askForTheCode('owner@example.com');
    await typeTheCode('111222');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

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
    expect(mocks.requestEmailCode).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/dashboard'));
  });

  it('switches back to the email', async () => {
    renderForm();
    await userEvent.click(screen.getByTestId('switch-login'));
    await userEvent.click(screen.getByTestId('switch-login'));
    expect(screen.getByPlaceholderText('name@company.com')).toBeInTheDocument();
  });
});
