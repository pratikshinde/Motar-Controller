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
  useListPumpFaults: jest.fn().mockReturnValue({ data: [] }),
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

  it('a START that ended in a fault says so, does not claim "Done", and can be dismissed', () => {
    const onDismiss = jest.fn();
    render(<CommandStepper action="START" progress={{ kind: 'faulted' }} onDismiss={onDismiss} />);
    expect(screen.getByText('The pump did not start because of a fault. The fault is shown at the top of the screen.')).toBeTruthy();
    expect(screen.queryByText('The pump has done it.')).toBeNull();
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
    expect(screen.getByText('Dry Run Fault')).toBeTruthy();
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
    fireEvent.changeText(screen.getByTestId('timer-off'), '300');
    fireEvent.press(screen.getByTestId('timer-save'));
    expect(screen.getByText('Enter 0 to 250 minutes')).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
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
    expect(screen.getByLabelText('Line voltages')).toBeTruthy();
    expect(screen.getByLabelText('Phase currents')).toBeTruthy();
    expect(screen.queryByText('SOLAR VFD')).toBeNull();
  });

  const renderAc = (pump: PumpResponse, onOpenFaults: () => void = jest.fn()) =>
    render(
      <QueryClientProvider client={qc}>
        <LiveTab pump={pump} onOpenFaults={onOpenFaults} onOpenTimer={jest.fn()} onOpenHistory={jest.fn()} />
      </QueryClientProvider>,
    );

  it("Ajanta's Live screen: a running pump shows whole volts and amps, ticks for voltages, currents and sequence, and no faults", () => {
    renderAc(acPump);
    expect(screen.getAllByLabelText('OK')).toHaveLength(2); // line voltages and phase currents
    expect(screen.getByLabelText('Correct sequence')).toBeTruthy();
    expect(screen.getByLabelText('No faults')).toBeTruthy();
    expect(screen.getByLabelText('Controller connected')).toBeTruthy();
    expect(screen.getByLabelText('R-Y 415 V')).toBeTruthy(); // whole volts, as the starter shows them
    expect(screen.getByLabelText('R 10 A')).toBeTruthy();
  });

  it('a pump that went quiet is Offline and no card claims everything is fine', () => {
    renderAc({ ...acPump, last_seen_at: new Date(Date.now() - 20 * 60 * 1000).toISOString() });
    expect(screen.queryByLabelText('OK')).toBeNull();
    expect(screen.queryByLabelText('Correct sequence')).toBeNull();
    expect(screen.queryByLabelText('No faults')).toBeNull();
    expect(screen.getAllByLabelText('Offline').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('R-Y 0 V')).toBeTruthy(); // nothing connected: 0 V on the three rings, not the old reading
    expect(screen.getByLabelText('Y-B 0 V')).toBeTruthy();
    expect(screen.getByLabelText('B-R 0 V')).toBeTruthy();
    expect(screen.queryByLabelText('R-Y 415 V')).toBeNull();
  });

  it('a pump that has been quiet for a few minutes says the power may be off or there is no signal', () => {
    renderAc({ ...acPump, last_seen_at: new Date(Date.now() - 4 * 60 * 1000).toISOString() });
    expect(screen.getByTestId('pump-offline')).toBeTruthy();
    expect(screen.getByText('The pump has not been heard from for a few minutes. The power may be off, or there is no mobile signal.')).toBeTruthy();
  });

  it('a pump heard from 2 minutes ago is still online', () => {
    renderAc({ ...acPump, last_seen_at: new Date(Date.now() - 2 * 60 * 1000).toISOString() });
    expect(screen.queryByTestId('pump-offline')).toBeNull();
  });

  it("shows the module's signal: bars, the word and the dBm it measured", () => {
    renderAc({ ...acPump, signal_dbm: -69 });
    expect(screen.getByLabelText('GSM, Excellent, -69 dBm')).toBeTruthy();
    expect(screen.getByText('-69 dBm')).toBeTruthy();
  });

  it('a pump that went quiet has no signal to show, not the last one it reported', () => {
    renderAc({ ...acPump, signal_dbm: -69, last_seen_at: new Date(Date.now() - 20 * 60 * 1000).toISOString() });
    expect(screen.getByLabelText('GSM, No signal')).toBeTruthy();
    expect(screen.queryByText('-69 dBm')).toBeNull();
  });

  it('a pump that has never reported shows 0 V and No reading', () => {
    renderAc({ ...acPump, last_seen_at: null, v_ry: null, v_yb: null, v_br: null, i_r: null, i_y: null, i_b: null });
    expect(screen.getByLabelText('R-Y 0 V')).toBeTruthy();
    expect(screen.getAllByLabelText('No reading').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('OK')).toBeNull();
  });

  it("shows today's run time and the starter's total run time (hours:minutes, as its display), never an invented value", () => {
    renderAc({ ...acPump, runtime_today_min: 192, total_runtime_min: 125 });
    expect(screen.getByLabelText("Today's run time")).toBeTruthy();
    expect(screen.getByText('3 h 12 min')).toBeTruthy();
    expect(screen.getByLabelText('TOTAL RUN TIME')).toBeTruthy();
    expect(screen.getByText('002:05')).toBeTruthy();
  });

  it('shows no total tile when the pump has not reported its total run time', () => {
    renderAc({ ...acPump, runtime_today_min: 5, total_runtime_min: null });
    expect(screen.queryByLabelText('TOTAL RUN TIME')).toBeNull();
  });

  it('a tripped pump shows a fault, not "No faults", and no OK chip on the currents', () => {
    renderAc({ ...acPump, status: 'FAULT', fault_active: true, fault_code: 5 });
    expect(screen.queryByText('No faults')).toBeNull();
    expect(screen.getAllByText('Fault').length).toBeGreaterThan(0);
    expect(screen.queryByText('Correct sequence')).toBeNull();
  });

  describe('a fault is shown once, in the banner above the pump card', () => {
    const tripped = (code: number): PumpResponse => ({ ...acPump, status: 'FAULT', fault_active: true, pump_on: false, fault_code: code });

    it('a current fault (cable open) says so, names the fault and what to do, and the faults card below is gone', () => {
      renderAc(tripped(6));
      expect(screen.getByTestId('fault-banner')).toBeTruthy();
      expect(screen.getByText('Current fault')).toBeTruthy();
      expect(screen.getAllByText('Cable open')).toHaveLength(1); // not repeated further down
      expect(screen.getByText('Check the cable and joints from the panel to the motor. Call your dealer.')).toBeTruthy();
      expect(screen.queryByText('Pump faults')).toBeNull();
      expect(screen.queryByText('Voltage fault')).toBeNull();
    });

    it('a voltage fault (high voltage) says Voltage fault', () => {
      renderAc(tripped(3));
      expect(screen.getByText('Voltage fault')).toBeTruthy();
      expect(screen.getByText('Over voltage')).toBeTruthy();
      expect(screen.queryByText('Current fault')).toBeNull();
    });

    it("the starter's own current faults are named the way its display names them", () => {
      renderAc(tripped(9)); // the starter's load-imbalance trip: "Motor Fault" on its display, a current fault
      expect(screen.getByText('Current fault')).toBeTruthy();
      expect(screen.getByText('Motor Fault')).toBeTruthy();
      expect(screen.queryByText('Voltage imbalance')).toBeNull();
    });

    it('tapping the banner opens the fault details', () => {
      const open = jest.fn();
      renderAc(tripped(8), open);
      fireEvent.press(screen.getByTestId('fault-banner'));
      expect(open).toHaveBeenCalledTimes(1);
    });

    it('pressing the power button during a current fault says to reset the starter, and sends no command', () => {
      renderAc(tripped(6));
      fireEvent.press(screen.getByTestId('power-button'));
      expect(screen.getByTestId('fault-power-note')).toBeTruthy();
      expect(screen.getByText(/reset the starter with its button/)).toBeTruthy();
      expect(api.sendPumpCommand).not.toHaveBeenCalled();
    });

    it('during a voltage fault it says the fault clears by itself when the supply is normal', () => {
      renderAc(tripped(3));
      fireEvent.press(screen.getByTestId('power-button'));
      expect(screen.getByText(/clears by itself when the supply is normal/)).toBeTruthy();
      expect(api.sendPumpCommand).not.toHaveBeenCalled();
    });

    it('a pump with no fault has no banner and shows the green no-faults mark', () => {
      renderAc(acPump);
      expect(screen.queryByTestId('fault-banner')).toBeNull();
      expect(screen.getByLabelText('No faults')).toBeTruthy();
    });

    describe('a fresh trip whose code has not reached the pump reading yet', () => {
      const listFaults = api.useListPumpFaults as jest.Mock;
      const justTripped: PumpResponse = { ...tripped(0), fault_code: null, last_seen_at: new Date().toISOString() };
      const record = (over: Record<string, unknown>) => ({ id: 1, fault_code: 6, occurred_at: new Date().toISOString(), resolved_at: null, ...over });

      it('takes the code from the open fault record, so the right fault shows at once', () => {
        listFaults.mockReturnValue({ data: [record({})] });
        renderAc(justTripped);
        expect(screen.getByText('Current fault')).toBeTruthy();
        expect(screen.getByText('Cable open')).toBeTruthy();
      });

      it('does not borrow an old fault that was left open from another day', () => {
        listFaults.mockReturnValue({ data: [record({ occurred_at: new Date(Date.now() - 3 * 3600_000).toISOString() })] });
        renderAc(justTripped);
        expect(screen.getByTestId('fault-banner')).toBeTruthy();
        expect(screen.queryByText('Cable open')).toBeNull();
        expect(screen.getByText('The pump found a problem it could not name.')).toBeTruthy();
      });

      it('with no record yet, still says there is a fault rather than nothing', () => {
        listFaults.mockReturnValue({ data: [] });
        renderAc(justTripped);
        expect(screen.getByTestId('fault-banner')).toBeTruthy();
        expect(screen.queryByText('No faults')).toBeNull();
      });
    });

    it('a fault code the app does not know is still shown, without a kind', () => {
      renderAc(tripped(42));
      expect(screen.getByText('Fault (code 42)')).toBeTruthy();
      expect(screen.queryByText('Current fault')).toBeNull();
      expect(screen.queryByText('Voltage fault')).toBeNull();
    });
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

