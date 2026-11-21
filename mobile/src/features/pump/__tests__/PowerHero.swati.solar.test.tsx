import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import i18n from '@/shared/i18n';
import { PowerHeroSwati } from '../PowerHero.swati';

const base = { name: 'SolarLogger 7022', hp: 7.5, supplyType: 'Solar', rotation: null, signalDbm: -70, busy: false, disabled: false, cooldownLeft: 0, onPower: jest.fn() };

beforeEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

describe('the SolarLogger device only reports: the logger cannot start or stop the drive', () => {
  it('shows no Start/Stop button and no timer for a solar device', () => {
    render(<PowerHeroSwati {...base} isSolar solar={{ hz: 0, iOut: 0, vAc: 0, vDc: 312.5, kw: 0, status: 'STOPPED' }} state="stopped" />);
    expect(screen.queryByTestId('power-button')).toBeNull();
    expect(screen.queryByText(/timer/i)).toBeNull();
  });

  it('still shows the Start/Stop button for an ordinary pump', () => {
    render(<PowerHeroSwati {...base} supplyType="3-phase" rotation="ok" state="stopped" />);
    expect(screen.getByTestId('power-button')).toBeTruthy();
  });
});
