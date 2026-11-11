import React from 'react';
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import i18n from '@/shared/i18n';
import { normalizePhone } from '@/shared/phone';
import { useAuth } from '@/state/auth';
import { LoginScreen } from '../LoginScreen';

// Ajanta's farmers have no password: a mobile number and the SMS code sent to it are the whole sign-in (jest builds the first
// brand, which is Ajanta).
// The painted banner makes these screens slow to draw when the whole suite runs at once: wait longer before giving up.
configure({ asyncUtilTimeout: 5000 });

beforeEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  jest.clearAllMocks();
});

function renderLogin() {
  const props = { onLoginSuccess: jest.fn(), onForgotPassword: jest.fn(), onRegister: jest.fn() };
  render(<LoginScreen {...props} />);
  return props;
}

describe('Ajanta sign-in: the first visit is scanning the dealer\'s QR code', () => {
  it('leads with Scan QR code and, while phone sign-in is not offered, has no way to the mobile number form', () => {
    const onScanQr = jest.fn();
    render(<LoginScreen onLoginSuccess={jest.fn()} onForgotPassword={jest.fn()} onRegister={jest.fn()} onScanQr={onScanQr} />);
    expect(screen.queryByPlaceholderText('10-digit mobile number')).toBeNull();
    expect(screen.queryByText('Already registered? Use your mobile number')).toBeNull();
    fireEvent.press(screen.getByText('Scan QR code'));
    expect(onScanQr).toHaveBeenCalledTimes(1);
  });
});

describe('Ajanta sign-in: mobile number and SMS code only', () => {
  it('has no password, no forgot-password and no create-account step', () => {
    renderLogin();
    expect(screen.queryByPlaceholderText('Your password')).toBeNull();
    expect(screen.queryByText('Forgot Password?')).toBeNull();
    expect(screen.queryByText('Create an account')).toBeNull();
    expect(screen.queryByText(/WhatsApp/i)).toBeNull();
    expect(screen.getByText('Send code by SMS')).toBeTruthy();
  });

  it('sends the code to the number, then signs in with the code', async () => {
    const sendOtp = jest.fn().mockResolvedValue({ message: 'sent' });
    const signInWithOtp = jest.fn().mockResolvedValue({ user: { id: 'u1' }, mfaRequired: false });
    useAuth.setState({ sendOtp, signInWithOtp } as never);
    const props = renderLogin();

    fireEvent.changeText(screen.getByPlaceholderText('10-digit mobile number'), '9606595604');
    fireEvent.press(screen.getByText('Send code by SMS'));
    await waitFor(() => expect(sendOtp).toHaveBeenCalledWith(normalizePhone('9606595604')));

    fireEvent.changeText(await screen.findByPlaceholderText('123456'), '482913');
    fireEvent.press(screen.getByText('Verify OTP'));
    await waitFor(() => expect(signInWithOtp).toHaveBeenCalledWith(normalizePhone('9606595604'), '482913'));
    await waitFor(() => expect(props.onLoginSuccess).toHaveBeenCalledTimes(1));
  });

  it('asks for the number first when it is empty and sends nothing', async () => {
    const sendOtp = jest.fn();
    useAuth.setState({ sendOtp } as never);
    renderLogin();
    fireEvent.press(screen.getByText('Send code by SMS'));
    expect(await screen.findByText('Please enter your mobile number')).toBeTruthy();
    expect(sendOtp).not.toHaveBeenCalled();
  });
});
