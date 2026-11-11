import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import i18n from '@/shared/i18n';
import { formatWhen } from '@/shared/i18n/format';
import { AjantaPowerBanner } from '../pump/LiveCards.ajanta';

beforeEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('en');
  });
});

describe('formatWhen', () => {
  const now = new Date(2026, 10, 11, 20, 0); // Wed 11 Nov 2026, 8 pm local time

  it('is just the time for today, in 12-hour form', () => {
    expect(formatWhen('en', new Date(2026, 10, 11, 6, 42).toISOString(), now)).toMatch(/^6:42\s?AM$/i);
    expect(formatWhen('en', new Date(2026, 10, 11, 19, 15).toISOString(), now)).toMatch(/^7:15\s?PM$/i);
  });

  it('names the day for an earlier day, and shows a dash for nothing', () => {
    expect(formatWhen('en', new Date(2026, 10, 9, 6, 42).toISOString(), now)).toMatch(/^Mon,\s6:42\s?AM$/i);
    expect(formatWhen('en', null, now)).toBe('—');
  });
});

describe('AjantaPowerBanner', () => {
  const iso = new Date().toISOString();

  it('says the power is on, and since when', () => {
    render(<AjantaPowerBanner state="ON" since={iso} source="VOLTAGE" />);
    expect(screen.getByText('Power is ON')).toBeTruthy();
    expect(screen.getByText(/^Since /)).toBeTruthy();
    expect(screen.getByTestId('power-banner').props.accessibilityLabel).toMatch(/Power is ON\. Since /);
  });

  it('says the power is off when the starter itself reported no voltage', () => {
    render(<AjantaPowerBanner state="OFF" since={iso} source="VOLTAGE" />);
    expect(screen.getByText('Power is OFF')).toBeTruthy();
  });

  it('only says the power may be off when the pump simply stopped reporting', () => {
    render(<AjantaPowerBanner state="OFF" since={iso} source="CONTACT" />);
    expect(screen.getByText('Power may be off')).toBeTruthy();
    expect(screen.queryByText('Power is OFF')).toBeNull();
  });
});
