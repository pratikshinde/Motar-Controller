import React from 'react';
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import i18n from '@/shared/i18n';
import { normalizePhone } from '@/shared/phone';
import { useAuth } from '@/state/auth';
import { startPhoneSignIn } from '@/services/firebasePhone';
import { LoginScreen } from '../LoginScreen';

// Where Firebase is set up (the Ajanta Android app) the SMS code comes from Firebase and the backend only checks its signed token.
jest.mock('@/services/firebasePhone', () => ({
  ...jest.requireActual('@/services/firebasePhone'),
  firebasePhoneSupported: true,
  startPhoneSignIn: jest.fn(),
}));

const start = startPhoneSignIn as jest.MockedFunction<typeof startPhoneSignIn>;

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

async function sendCode() {
  fireEvent.changeText(screen.getByPlaceholderText('10-digit mobile number'), '9606595604');
  fireEvent.press(screen.getByText('Send code by SMS'));
  return screen.findByPlaceholderText('123456');
}

describe('Ajanta sign-in through Firebase Phone Authentication', () => {
  it('asks Firebase for the code (not our own backend), then signs in with the token Firebase returns', async () => {
    const confirm = jest.fn().mockResolvedValue('firebase-id-token-0123456789');
    start.mockResolvedValue({ confirm });
    const sendOtp = jest.fn();
    const signInWithFirebase = jest.fn().mockResolvedValue({ user: { id: 'u1' }, mfaRequired: false });
    useAuth.setState({ sendOtp, signInWithFirebase } as never);
    const props = renderLogin();

    fireEvent.changeText(await sendCode(), '482913');
    expect(start).toHaveBeenCalledWith(normalizePhone('9606595604'));
    expect(sendOtp).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('Verify OTP'));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('482913'));
    await waitFor(() => expect(signInWithFirebase).toHaveBeenCalledWith('firebase-id-token-0123456789'));
    await waitFor(() => expect(props.onLoginSuccess).toHaveBeenCalledTimes(1));
  });

  it('says the code is wrong in plain words, and signs nobody in', async () => {
    const confirm = jest.fn().mockRejectedValue(Object.assign(new Error('bad'), { code: 'auth/invalid-verification-code' }));
    start.mockResolvedValue({ confirm });
    const signInWithFirebase = jest.fn();
    useAuth.setState({ signInWithFirebase } as never);
    const props = renderLogin();

    fireEvent.changeText(await sendCode(), '000000');
    fireEvent.press(screen.getByText('Verify OTP'));
    expect(await screen.findByText('That code is not right. Please check it and try again.')).toBeTruthy();
    expect(signInWithFirebase).not.toHaveBeenCalled();
    expect(props.onLoginSuccess).not.toHaveBeenCalled();
  });

  it('says so when Firebase refuses to send too many codes', async () => {
    start.mockRejectedValue(Object.assign(new Error('slow down'), { code: 'auth/too-many-requests' }));
    renderLogin();
    fireEvent.changeText(screen.getByPlaceholderText('10-digit mobile number'), '9606595604');
    fireEvent.press(screen.getByText('Send code by SMS'));
    expect(await screen.findByText('Too many attempts. Please wait a little and try again.')).toBeTruthy();
  });
});
