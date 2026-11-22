import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import i18n from '@/shared/i18n';
import { PowerHeroSwati } from '../PowerHero.swati';

const base = { name: 'SolarLogger 7022', hp: 7.5, supplyType: 'Solar', rotation: null, signalDbm: -70, busy: false, disabled: false, cooldownLeft: 0, onPower: jest.fn() };

beforeEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

describe('the SolarLogger device: Start/Stop switch the drive through the logger, there is no timer', () => {
  it('shows its own Start and Stop buttons but no timer for a solar device', () => {
    render(<PowerHeroSwati {...base} isSolar solar={{ hz: 0, iOut: 0, vAc: 0, vDc: 312.5, kw: 0, status: 'STOPPED' }} state="stopped" />);
    expect(screen.getByTestId('start-button')).toBeTruthy();
    expect(screen.getByTestId('stop-button')).toBeTruthy();
    expect(screen.queryByText(/timer/i)).toBeNull();
  });

  it('still shows the Start/Stop button for an ordinary pump', () => {
    render(<PowerHeroSwati {...base} supplyType="3-phase" rotation="ok" state="stopped" />);
    expect(screen.getByTestId('power-button')).toBeTruthy();
  });
});

describe('the Start and Stop buttons stay visible when the device cannot be reached', () => {
  it('shows both, greyed out and pressing nothing, when it is offline', () => {
    const onStart = jest.fn();
    render(<PowerHeroSwati {...base} isSolar disabled state="offline" onStart={onStart} onStop={jest.fn()} />);
    expect(screen.getByTestId('start-button')).toBeTruthy();
    expect(screen.getByTestId('stop-button')).toBeTruthy();
    fireEvent.press(screen.getByTestId('start-button'));
    expect(onStart).not.toHaveBeenCalled();
  });

  it('Start works on a stopped device, Stop on a running one', () => {
    const onStart = jest.fn();
    const onStop = jest.fn();
    const { rerender } = render(<PowerHeroSwati {...base} isSolar state="stopped" onStart={onStart} onStop={onStop} />);
    fireEvent.press(screen.getByTestId('start-button'));
    fireEvent.press(screen.getByTestId('stop-button'));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
    rerender(<PowerHeroSwati {...base} isSolar state="running" onStart={onStart} onStop={onStop} />);
    fireEvent.press(screen.getByTestId('stop-button'));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
