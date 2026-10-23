import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AlertOut, PumpResponse } from '@/api/generated/model';
import i18n from '@/shared/i18n';
import { AlertsScreen } from '../alerts/AlertsScreen';
import { CommandStepper } from '../commands/CommandStepper';
import { PowerHero } from '../pump/PowerHero';
import { LiveTab } from '../pump/LiveTab';
import { TimerTab } from '../timer/TimerTab';
import * as api from '@/api/generated/farmer';

jest.mock('@/api/generated/farmer', () => ({
  ...jest.requireActual('@/api/generated/farmer'),
  useGetPumpTimer: jest.fn(),
  setPumpTimer: jest.fn(),
  useListAlerts: jest.fn(),
  useAckAlert: jest.fn(),
  useResolveAlert: jest.fn(),
  useGetPumpCommand: jest.fn().mockReturnValue({ data: null }),
  sendPumpCommand: jest.fn(),
}));

beforeEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  jest.clearAllMocks();
});

describe('PowerHero (the ON / OFF button farmers know)', () => {
  const base = { name: 'Borewell Pump', hp: 15, supplyType: '3-phase', rotation: 'ok' as const, signalDbm: -70, busy: false, disabled: false, cooldownLeft: 0 };

  it('shows the pump name and HP, and reports a press', () => {
    const onPower = jest.fn();
    render(<PowerHero {...base} state="running" onPower={onPower} />);
    expect(screen.getByText(/Borewell Pump/)).toBeTruthy();
    expect(screen.getByText('PUMP ON')).toBeTruthy();
    expect(screen.getByText('RUNNING')).toBeTruthy();
    fireEvent.press(screen.getByTestId('power-button'));
    expect(onPower).toHaveBeenCalledTimes(1);
  });

  it('a pump that is not reporting is NOT REPORTING and Offline, not "PUMP OFF"', () => {
    render(<PowerHero {...base} state="offline" onPower={jest.fn()} />);
    expect(screen.getByText('NOT REPORTING')).toBeTruthy();
    expect(screen.getByText('Offline')).toBeTruthy();
    expect(screen.queryByText('PUMP OFF')).toBeNull();
  });

  it('a stopped pump reads PUMP OFF and STOPPED; a faulted one reads Fault', () => {
    const { rerender } = render(<PowerHero {...base} state="stopped" onPower={jest.fn()} />);
    expect(screen.getByText('PUMP OFF')).toBeTruthy();
    expect(screen.getByText('STOPPED')).toBeTruthy();
    rerender(<PowerHero {...base} state="fault" onPower={jest.fn()} />);
    expect(screen.getByText('Fault')).toBeTruthy();
  });

  it('cannot be pressed while disabled (cooldown, offline phone, suspended pump) and shows the wait', () => {
    const onPower = jest.fn();
    render(<PowerHero {...base} state="stopped" disabled cooldownLeft={37} onPower={onPower} />);
    fireEvent.press(screen.getByTestId('power-button'));
    expect(onPower).not.toHaveBeenCalled();
    expect(screen.getByText('Wait 37 s')).toBeTruthy();
  });
});

describe('CommandStepper', () => {
  const noop = jest.fn();

  it('ticks only the steps that happened and waits on the next', () => {
    render(<CommandStepper action="STOP" progress={{ kind: 'inProgress', reached: 0 }} onDismiss={noop} />);
    expect(screen.getByLabelText('Sent ✓')).toBeTruthy();
    expect(screen.getByLabelText('Reached the pump')).toBeTruthy();
    expect(screen.queryByLabelText('Done ✓')).toBeNull();
  });

  it('says "not confirmed yet" (not failed) when the pump has not answered in time', () => {
    render(<CommandStepper action="START" progress={{ kind: 'notConfirmed', reached: 0 }} onDismiss={noop} />);
    expect(screen.getByText(/Not confirmed yet/)).toBeTruthy();
    expect(screen.queryByText(/refused/)).toBeNull();
    fireEvent.press(screen.getByText('Dismiss'));
    expect(noop).toHaveBeenCalled();
  });

  it('a command the server could not send says the pump was not asked, and can be dismissed', () => {
    const onDismiss = jest.fn();
    render(<CommandStepper action="START" progress={{ kind: 'notSent' }} onDismiss={onDismiss} />);
    expect(screen.getByText(/pump was not asked/)).toBeTruthy();
    expect(screen.queryByLabelText('Reached the pump ✓')).toBeNull();
    fireEvent.press(screen.getByText('Dismiss'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('shows all four steps done, then clears itself a few seconds later', () => {
    jest.useFakeTimers();
    const onDismiss = jest.fn();
    render(<CommandStepper action="STOP" progress={{ kind: 'done' }} onDismiss={onDismiss} />);
    for (const step of ['Sent', 'Reached the pump', 'Pump confirmed', 'Done'])
      expect(screen.getByLabelText(`${step} ✓`)).toBeTruthy();
    expect(screen.getByText('The pump has done it.')).toBeTruthy();
    act(() => void jest.advanceTimersByTime(6100));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('shows the pump refusing, with its reason', () => {
    render(<CommandStepper action="START" progress={{ kind: 'rejected', reason: 'FAULT_ACTIVE' }} onDismiss={noop} />);
    expect(screen.getByText('The pump refused: FAULT_ACTIVE')).toBeTruthy();
  });

  it('a request that never got an answer offers "Try again" with the same request', () => {
    const onRetry = jest.fn();
    render(<CommandStepper action="STOP" progress={null} sendFailed onRetry={onRetry} onDismiss={noop} />);
    fireEvent.press(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('AlertsScreen', () => {
  const listHook = api.useListAlerts as jest.Mock;
  const ackHook = api.useAckAlert as jest.Mock;
  const resolveHook = api.useResolveAlert as jest.Mock;

  const faultAlert: AlertOut = {
    id: 'A1', pump_id: 'P1', pump_name: 'Borewell Pump', alert_type: 'FAULT', severity: 'HIGH',
    fault_code: 5, occurrence_count: 1, last_occurred_at: '2026-09-29T05:00:00Z', resolved_at: null,
  };
  const offlineAlert: AlertOut = {
    id: 'A2', pump_id: 'P2', pump_name: 'Canal Pump', alert_type: 'OFFLINE', severity: 'HIGH',
    fault_code: 0, occurrence_count: 1, last_occurred_at: new Date(Date.now() - 65 * 60_000).toISOString(),
    resolved_at: null,
  };

  const mount = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })}>
        <AlertsScreen />
      </QueryClientProvider>,
    );

  beforeEach(() => {
    listHook.mockReturnValue({ data: { alerts: [faultAlert, offlineAlert] }, isLoading: false, isError: false });
    ackHook.mockReturnValue({ mutate: jest.fn(), isPending: false });
    resolveHook.mockReturnValue({ mutate: jest.fn(), isPending: false });
  });

  it('titles a fault alert from its fault code', () => {
    mount();
    expect(screen.getByText('Dry run (no water)')).toBeTruthy();
  });

  it('titles a connectivity alert from the pump name and how long ago, not the generic "Pump alert"', () => {
    mount();
    expect(screen.getByText('Canal Pump is not reporting. The last news was 1 h ago.')).toBeTruthy();
    expect(screen.queryByText('Pump alert')).toBeNull();
  });
});

describe('TimerTab', () => {
  const pump = { id: 'P1', name: 'Borewell Pump', display_name: 'Borewell', lifecycle_state: 'ACTIVE' } as PumpResponse;
  const timerHook = api.useGetPumpTimer as jest.Mock;
  const send = api.setPumpTimer as jest.Mock;

  const mount = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })}>
        <TimerTab pump={pump} />
      </QueryClientProvider>,
    );

  beforeEach(() => {
    timerHook.mockReturnValue({ data: { message: '', timer: null } });
    send.mockResolvedValue({ message: 'ok', timer: null });
  });

  it('says no timer was sent instead of showing an invented default', () => {
    mount();
    expect(screen.getByText('You have not sent a timer yet.')).toBeTruthy();
  });

  it('refuses out-of-range values with a message and does not ask to confirm', () => {
    mount();
    fireEvent.changeText(screen.getByTestId('timer-on'), '300');
    fireEvent.press(screen.getByTestId('timer-save'));
    expect(screen.getByText('Enter 1 to 250 minutes')).toBeTruthy();
    expect(screen.queryByText('Set the timer on Borewell?')).toBeNull();
    fireEvent.changeText(screen.getByTestId('timer-on'), '0');
    fireEvent.press(screen.getByTestId('timer-save'));
    expect(screen.getByText('Enter 1 to 250 minutes')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('timer-on'), '30');
    fireEvent.changeText(screen.getByTestId('timer-cycles'), '1000');
    fireEvent.press(screen.getByTestId('timer-save'));
    expect(screen.getByText('Enter 0 to 999')).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });

  it('names the pump, sends one request with an Idempotency-Key, and admits it is not confirmed', async () => {
    mount();
    fireEvent.changeText(screen.getByTestId('timer-on'), '30');
    fireEvent.changeText(screen.getByTestId('timer-off'), '10');
    fireEvent.changeText(screen.getByTestId('timer-cycles'), '3');
    fireEvent.press(screen.getByTestId('timer-save'));
    expect(screen.getByText('Set the timer on Borewell?')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('confirm-yes'));
    });
    expect(send).toHaveBeenCalledTimes(1);
    const [id, body, options] = send.mock.calls[0];
    expect(id).toBe('P1');
    expect(body).toEqual({ on_duration_minutes: 30, off_duration_minutes: 10, cycle_count: 3, mode: 'CYCLIC' });
    expect(options.headers['Idempotency-Key']).toMatch(/[0-9a-f-]{20,}/);
    expect(screen.getByText(/not confirmed yet/)).toBeTruthy();
  });

  it('cannot be sent to a suspended pump', () => {
    timerHook.mockReturnValue({ data: { message: '', timer: null } });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimerTab pump={{ ...pump, lifecycle_state: 'SUSPENDED' } as PumpResponse} />
      </QueryClientProvider>,
    );
    fireEvent.press(screen.getByTestId('timer-save'));
    expect(screen.queryByText('Set the timer on Borewell?')).toBeNull();
    expect(screen.getByText('Timers cannot be sent while remote control is paused.')).toBeTruthy();
  });
});

describe('LiveTab (Solar VFD vs AC 3-Phase)', () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const solarPump: PumpResponse = {
    id: 'solar-1',
    name: 'Solar Pump',
    hierarchy_path: 'root.swati.dealer.farmer',
    lifecycle_state: 'ACTIVE',
    status: 'RUNNING',
    supply_type: '3-phase',
    device_type: 'SOLAR_VFD',
    pump_on: true,
    last_seen_at: new Date().toISOString(),
    vfd_hz: 48.5,
    vfd_kw: 3.2,
    vfd_v_dc: 580.0,
    vfd_v_ac: 380.0,
    vfd_i_out: 7.5,
    vfd_status: 'RUNNING',
  };

  const acPump: PumpResponse = {
    id: 'ac-1',
    name: 'Grid AC Pump',
    hierarchy_path: 'root.ajanta.dealer.farmer',
    lifecycle_state: 'ACTIVE',
    status: 'RUNNING',
    supply_type: '3-phase',
    device_type: 'AC_3PH',
    pump_on: true,
    last_seen_at: new Date().toISOString(),
    v_ry: 415.0,
    v_yb: 418.0,
    v_br: 412.0,
    i_r: 10.2,
    i_y: 9.8,
    i_b: 10.0,
  };

  it('renders Solar VFD metrics and hides 3-phase rings/bars for SOLAR_VFD pumps', () => {
    render(
      <QueryClientProvider client={qc}>
        <LiveTab pump={solarPump} onOpenFaults={jest.fn()} onOpenTimer={jest.fn()} onOpenHistory={jest.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByText('SOLAR VFD')).toBeTruthy();
    expect(screen.getByText('48.5')).toBeTruthy();
    expect(screen.getByText('3.2')).toBeTruthy();
    expect(screen.getByText('580')).toBeTruthy();
    expect(screen.getByText('380')).toBeTruthy();
    expect(screen.getByText('7.5')).toBeTruthy();
    expect(screen.queryByText('LINE VOLTAGES')).toBeNull();
    expect(screen.queryByText('PHASE CURRENTS')).toBeNull();
  });

  it('renders 3-phase line voltages and currents for AC_3PH pumps and hides SOLAR VFD', () => {
    render(
      <QueryClientProvider client={qc}>
        <LiveTab pump={acPump} onOpenFaults={jest.fn()} onOpenTimer={jest.fn()} onOpenHistory={jest.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByText('LINE VOLTAGES')).toBeTruthy();
    expect(screen.getByText('PHASE CURRENTS')).toBeTruthy();
    expect(screen.queryByText('SOLAR VFD')).toBeNull();
  });

  it('shows em dash for missing solar readings rather than inventing numbers', () => {
    const emptySolar: PumpResponse = {
      ...solarPump,
      vfd_hz: null,
      vfd_kw: null,
      vfd_v_dc: null,
      vfd_v_ac: null,
      vfd_i_out: null,
    };
    render(
      <QueryClientProvider client={qc}>
        <LiveTab pump={emptySolar} onOpenFaults={jest.fn()} onOpenTimer={jest.fn()} onOpenHistory={jest.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(5);
  });
});

