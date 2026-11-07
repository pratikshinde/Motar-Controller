import React from 'react';
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useCameraPermissions } from 'expo-camera';
import i18n from '@/shared/i18n';
import { normalizePhone } from '@/shared/phone';
import { useAuth } from '@/state/auth';
import { isClaimQr } from '@/features/claim/qr';
import { ScanQrScreen } from '../ScanQrScreen';

const GOOD_QR = 'AGP-CLAIM:abcdefghijklmnopqrstuvwxyz012345';

const camera = () => (globalThis as unknown as { __cameraProps: { onBarcodeScanned: (e: { data: string }) => void } }).__cameraProps;

// The painted banner makes these screens slow to draw when the whole suite runs at once: wait longer before giving up.
configure({ asyncUtilTimeout: 5000 });

beforeEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  jest.clearAllMocks();
  (useCameraPermissions as jest.Mock).mockReturnValue([{ granted: true }, jest.fn()]);
});

describe('isClaimQr', () => {
  it('accepts only a code that looks like one of ours', () => {
    expect(isClaimQr(GOOD_QR)).toBe(true);
    expect(isClaimQr(`  ${GOOD_QR}  `)).toBe(true);
    for (const bad of ['', null, undefined, 'https://example.com', 'AGP-CLAIM:short', 'AGP-CLAIM:' + 'x'.repeat(200), 'agp-claim:' + 'x'.repeat(30)]) {
      expect(isClaimQr(bad as string)).toBe(false);
    }
  });
});

describe('ScanQrScreen: the farmer\'s first sign-in', () => {
  it('scans the dealer\'s QR, asks for the registered number, and signs in without any OTP', async () => {
    const signInWithQr = jest.fn().mockResolvedValue({ user: { id: 'u1' }, mfaRequired: false });
    useAuth.setState({ signInWithQr } as never);
    const onSignedIn = jest.fn();
    render(<ScanQrScreen onBack={jest.fn()} onSignedIn={onSignedIn} />);

    expect(screen.getByText('Scan your QR code')).toBeTruthy();
    act(() => camera().onBarcodeScanned({ data: GOOD_QR }));

    fireEvent.changeText(await screen.findByPlaceholderText('10-digit mobile number'), '9876500001');
    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(signInWithQr).toHaveBeenCalledWith(GOOD_QR, normalizePhone('9876500001')));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
  });

  it('says so when the scanned code is not one of ours, and does not ask for a number', () => {
    render(<ScanQrScreen onBack={jest.fn()} onSignedIn={jest.fn()} />);
    act(() => camera().onBarcodeScanned({ data: 'https://example.com/not-ours' }));
    expect(screen.getByText('This is not an Ajanta QR code. Please scan the one your dealer gave you.')).toBeTruthy();
    expect(screen.queryByPlaceholderText('10-digit mobile number')).toBeNull();
  });

  it('shows the server\'s reason when the number does not match, and stays on the screen', async () => {
    const signInWithQr = jest.fn().mockRejectedValue({ response: { status: 400, data: { detail: 'That number does not match the one your dealer registered.' } } });
    useAuth.setState({ signInWithQr } as never);
    const onSignedIn = jest.fn();
    render(<ScanQrScreen onBack={jest.fn()} onSignedIn={onSignedIn} />);
    act(() => camera().onBarcodeScanned({ data: GOOD_QR }));
    fireEvent.changeText(await screen.findByPlaceholderText('10-digit mobile number'), '9000000000');
    fireEvent.press(screen.getByText('Continue'));
    expect(await screen.findByText('That number does not match the one your dealer registered.')).toBeTruthy();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('asks for the number before it sends anything', async () => {
    const signInWithQr = jest.fn();
    useAuth.setState({ signInWithQr } as never);
    render(<ScanQrScreen onBack={jest.fn()} onSignedIn={jest.fn()} />);
    act(() => camera().onBarcodeScanned({ data: GOOD_QR }));
    fireEvent.press(await screen.findByText('Continue'));
    expect(await screen.findByText('Please enter your mobile number')).toBeTruthy();
    expect(signInWithQr).not.toHaveBeenCalled();
  });

  it('lets the farmer scan again', async () => {
    render(<ScanQrScreen onBack={jest.fn()} onSignedIn={jest.fn()} />);
    act(() => camera().onBarcodeScanned({ data: GOOD_QR }));
    fireEvent.press(await screen.findByText('Scan again'));
    expect(await screen.findByTestId('scan-camera')).toBeTruthy();
  });

  it('asks for the camera first when it is not allowed yet', () => {
    const request = jest.fn();
    (useCameraPermissions as jest.Mock).mockReturnValue([{ granted: false }, request]);
    render(<ScanQrScreen onBack={jest.fn()} onSignedIn={jest.fn()} />);
    fireEvent.press(screen.getByText('Allow camera'));
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('scan-camera')).toBeNull();
  });
});
