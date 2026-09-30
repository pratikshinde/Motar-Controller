import React from 'react';
import { Alert, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { onlineManager } from '@tanstack/react-query';
import * as Speech from 'expo-speech';
import i18n from '@/shared/i18n';
import { BigActionButton } from '../BigActionButton';
import { ConfirmSheet } from '../ConfirmSheet';
import { ErrorBoundary } from '../ErrorBoundary';
import { ListenButton, pickVoiceLanguage } from '../ListenButton';
import { OfflineBanner } from '../OfflineBanner';
import { ValueTile } from '../ValueTile';

beforeEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  jest.clearAllMocks();
});

describe('ConfirmSheet', () => {
  const props = { confirmLabel: 'Yes, stop', cancelLabel: 'No, cancel', onConfirm: jest.fn(), onCancel: jest.fn() };

  it('names the pump in the question so a farmer with several pumps knows which one', () => {
    render(<ConfirmSheet {...props} visible title="Stop Borewell Pump?" message="Borewell Pump will stop." />);
    expect(screen.getByText('Stop Borewell Pump?')).toBeTruthy();
    expect(screen.getByText('Borewell Pump will stop.')).toBeTruthy();
  });

  it('confirm and cancel are separate, labelled buttons', () => {
    render(<ConfirmSheet {...props} visible title="Stop?" />);
    fireEvent.press(screen.getByTestId('confirm-yes'));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('confirm-no'));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows nothing when closed', () => {
    render(<ConfirmSheet {...props} visible={false} title="Stop Borewell Pump?" />);
    expect(screen.queryByText('Stop Borewell Pump?')).toBeNull();
  });

  it('cannot be confirmed twice while busy', () => {
    render(<ConfirmSheet {...props} visible title="Stop?" busy />);
    fireEvent.press(screen.getByTestId('confirm-yes'));
    fireEvent.press(screen.getByTestId('confirm-no'));
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
  });
});

describe('BigActionButton', () => {
  it('fires when enabled and not when disabled or loading', () => {
    const onPress = jest.fn();
    const { rerender } = render(<BigActionButton label="Send" onPress={onPress} testID="b" />);
    fireEvent.press(screen.getByTestId('b'));
    expect(onPress).toHaveBeenCalledTimes(1);
    rerender(<BigActionButton label="Send" onPress={onPress} testID="b" disabled />);
    fireEvent.press(screen.getByTestId('b'));
    rerender(<BigActionButton label="Send" onPress={onPress} testID="b" loading />);
    fireEvent.press(screen.getByTestId('b'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is announced as a button with its label and state', () => {
    render(<BigActionButton label="Send" onPress={jest.fn()} testID="b" disabled />);
    const b = screen.getByRole('button', { name: 'Send' });
    expect(b.props.accessibilityState).toMatchObject({ disabled: true });
  });
});

describe('ValueTile', () => {
  it('shows a dash, never a made-up number, when the pump did not report it', () => {
    render(<ValueTile label="Volts" value={null} unit="V" />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText('V')).toBeNull();
    expect(screen.getByLabelText('Volts: —')).toBeTruthy();
  });

  it('shows the value and unit, and a zero is a real zero', () => {
    const { rerender } = render(<ValueTile label="Current" value={12.3} unit="A" />);
    expect(screen.getByText('12.3')).toBeTruthy();
    expect(screen.getByText('A')).toBeTruthy();
    rerender(<ValueTile label="Current" value={0} unit="A" />);
    expect(screen.getByText('0')).toBeTruthy();
  });
});

describe('OfflineBanner', () => {
  afterEach(() => act(() => onlineManager.setOnline(true)));

  it('appears offline with the time of the saved data, and disappears when back online', () => {
    render(<OfflineBanner savedAt={Date.parse('2026-05-10T09:05:00')} />);
    expect(screen.queryByTestId('offline-banner')).toBeNull();
    act(() => onlineManager.setOnline(false));
    expect(screen.getByTestId('offline-banner')).toBeTruthy();
    expect(screen.getByText(/saved data from 09:05/)).toBeTruthy();
    act(() => onlineManager.setOnline(true));
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });

  it('says so when there is nothing saved to show', () => {
    render(<OfflineBanner />);
    act(() => onlineManager.setOnline(false));
    expect(screen.getByText(/Connect to the internet to load your pumps/)).toBeTruthy();
  });
});

describe('ErrorBoundary', () => {
  const Boom: React.FC<{ explode: boolean }> = ({ explode }) => {
    if (explode) throw new Error('kaboom');
    return <Text>fine</Text>;
  };

  it('shows a calm message and a retry instead of a white screen, and recovers', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    let explode = true;
    const Tree = () => (
      <ErrorBoundary>
        <Boom explode={explode} />
      </ErrorBoundary>
    );
    const { rerender } = render(<Tree />);
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText(/Your pumps are not affected/)).toBeTruthy();
    explode = false; // the cause is gone...
    rerender(<Tree />); // ...still showing the message until the person taps retry
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    expect(screen.getByText('fine')).toBeTruthy();
  });
});

describe('ListenButton (text-to-speech on the phone, no server)', () => {
  it('speaks the sentence in the app language and can be stopped', async () => {
    render(<ListenButton getText={() => 'Borewell Pump is running.'} testID="listen" />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('listen'));
    });
    expect(Speech.speak).toHaveBeenCalledWith(
      'Borewell Pump is running.',
      expect.objectContaining({ language: 'en-IN' }),
    );
    expect(screen.getByText('Stop')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('listen'));
    });
    expect(Speech.stop).toHaveBeenCalled();
    expect(screen.getByText('Listen')).toBeTruthy();
  });

  it('says so, and stays silent, when the phone has no voice for the language', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await act(async () => {
      await i18n.changeLanguage('ta'); // the mocked phone only has English and Hindi voices
    });
    render(<ListenButton getText={() => 'x'} testID="listen" />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('listen'));
    });
    expect(Speech.speak).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalled();
  });

  it('picks the first candidate voice the phone really has', async () => {
    expect(await pickVoiceLanguage(['mr-IN', 'hi-IN'])).toBe('hi-IN');
    expect(await pickVoiceLanguage(['ta-IN'])).toBeNull();
  });
});
