import React from 'react';
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import i18n from '@/shared/i18n';
import { normalizePhone } from '@/shared/phone';
import { useAuth } from '@/state/auth';
import { LoginScreen } from '../LoginScreen';

// SolarLogger: the account is made by an admin who hands over the password. Mobile number + password is the whole sign-in.
jest.mock('@/config/brand', () => {
  const actual = jest.requireActual('@/config/brand');
  return { ...actual, brand: { ...actual.brand, features: { push: false, firebasePhone: false, phoneOnly: false, passwordOnly: true, qrScan: false } } };
});

configure({ asyncUtilTimeout: 5000 });

beforeEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  jest.clearAllMocks();
});

describe('password-only sign-in (SolarLogger)', () => {
  it('shows mobile number + password, with no code tab, no sign-up, no forgot-password and no QR', () => {
    render(<LoginScreen onLoginSuccess={jest.fn()} onForgotPassword={jest.fn()} onRegister={jest.fn()} />);
    expect(screen.getByPlaceholderText('10-digit mobile number')).toBeTruthy();
    expect(screen.getByPlaceholderText('Your password')).toBeTruthy();
    expect(screen.queryByText(/WhatsApp/i)).toBeNull();
    expect(screen.queryByText('Forgot Password?')).toBeNull();
    expect(screen.queryByText('Create an account')).toBeNull();
    expect(screen.queryByText('Scan QR code')).toBeNull();
    expect(screen.queryByText('Send code by SMS')).toBeNull();
  });

  it('signs in with the number and the password', async () => {
    const signIn = jest.fn().mockResolvedValue({ user: { id: 'u1' }, mfaRequired: false });
    useAuth.setState({ signIn } as never);
    const onLoginSuccess = jest.fn();
    render(<LoginScreen onLoginSuccess={onLoginSuccess} onForgotPassword={jest.fn()} onRegister={jest.fn()} />);

    fireEvent.changeText(screen.getByPlaceholderText('10-digit mobile number'), '9606595604');
    fireEvent.changeText(screen.getByPlaceholderText('Your password'), 'Admin-given-pass1');
    fireEvent.press(screen.getByText('Login'));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith(normalizePhone('9606595604'), 'Admin-given-pass1'));
    await waitFor(() => expect(onLoginSuccess).toHaveBeenCalledTimes(1));
  });
});
