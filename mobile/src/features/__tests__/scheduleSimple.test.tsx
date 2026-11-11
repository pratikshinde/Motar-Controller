import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PumpResponse, ScheduleOut } from '@/api/generated/model';
import i18n from '@/shared/i18n';
import * as api from '@/api/generated/farmer';
import { SimpleScheduleEditor } from '../schedule/ScheduleSimple';
import { openNativeTimePicker } from '../schedule/nativeTimePicker';
import { Row, clock12h, rowsFromWindow, simpleWindowOf } from '../schedule/model';

jest.mock('@/api/generated/farmer', () => ({
  ...jest.requireActual('@/api/generated/farmer'),
  setPumpSchedule: jest.fn(),
}));

// The phone's own clock dialog: here, a stand-in that records what it was opened with and lets a test tap OK or Cancel.
const mockOpen = jest.fn();
jest.mock('@react-native-community/datetimepicker', () => ({ DateTimePickerAndroid: { open: (p: unknown) => mockOpen(p) } }));
jest.mock('../schedule/nativeTimePicker', () => {
  const actual = jest.requireActual('../schedule/nativeTimePicker');
  return { ...actual, hasNativeTimePicker: () => true };
});

beforeEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  jest.clearAllMocks();
});

let n = 0;
const row = (day: number, on: string, off: string, enabled = true): Row => ({ key: `s${++n}`, day, on, off, enabled });

describe('reading a saved schedule as one start and one stop', () => {
  it('is the default window on no days when nothing is saved', () => {
    expect(simpleWindowOf([])).toEqual({ on: '06:00', off: '09:00', days: [] });
  });

  it('is one window when every day has the same start and stop', () => {
    expect(simpleWindowOf([row(4, '07:00', '10:00'), row(0, '07:00', '10:00')])).toEqual({ on: '07:00', off: '10:00', days: [0, 4] });
  });

  it('is null, so the detailed editor opens, when anything would be lost', () => {
    expect(simpleWindowOf([row(0, '07:00', '10:00'), row(1, '08:00', '10:00')])).toBeNull(); // different times
    expect(simpleWindowOf([row(0, '07:00', '10:00'), row(0, '07:00', '10:00')])).toBeNull(); // two on one day
    expect(simpleWindowOf([row(0, '07:00', '10:00', false)])).toBeNull(); // a time that is switched off
  });

  it('makes one row for each chosen day, once', () => {
    const rows = rowsFromWindow({ on: '06:00', off: '09:00', days: [2, 0, 2] });
    expect(rows.map((r) => [r.day, r.on, r.off, r.enabled])).toEqual([[0, '06:00', '09:00', true], [2, '06:00', '09:00', true]]);
  });

  it('writes the clock the way the picker shows it, with a two-digit hour', () => {
    expect(clock12h('06:00', 'AM', 'PM')).toBe('06:00 AM');
    expect(clock12h('00:05', 'AM', 'PM')).toBe('12:05 AM');
    expect(clock12h('21:30', 'AM', 'PM')).toBe('09:30 PM');
  });
});

describe('the phone\'s own clock', () => {
  it('opens in clock style, 12-hour, at the current time, and hands back the OK time as 24-hour HH:MM', () => {
    const picked = jest.fn();
    openNativeTimePicker('13:05', picked);
    const props = mockOpen.mock.calls[0][0];
    expect(props).toMatchObject({ mode: 'time', display: 'clock', is24Hour: false });
    expect((props.value as Date).getHours()).toBe(13);
    expect((props.value as Date).getMinutes()).toBe(5);
    props.onChange({ type: 'set' }, new Date(2026, 0, 1, 7, 30));
    expect(picked).toHaveBeenCalledWith('07:30');
  });

  it('changes nothing on Cancel or when the dialog is dismissed', () => {
    const picked = jest.fn();
    openNativeTimePicker('06:00', picked);
    mockOpen.mock.calls[0][0].onChange({ type: 'dismissed' }, new Date(2026, 0, 1, 9, 0));
    expect(picked).not.toHaveBeenCalled();
  });
});

describe('SimpleScheduleEditor', () => {
  const pump = { id: 'P1', name: 'Borewell Pump', display_name: 'Borewell', lifecycle_state: 'ACTIVE' } as PumpResponse;
  const save = api.setPumpSchedule as jest.Mock;

  const schedule = (over: Partial<ScheduleOut> = {}): ScheduleOut => ({
    pump_id: 'P1',
    enabled: true,
    timezone: 'Asia/Kolkata',
    entries: [],
    next: null,
    recent: [],
    limits: { min_window_minutes: 5, min_gap_minutes: 5, max_rows: 50 },
    server_time: '2026-10-26T04:00:00+00:00',
    ...over,
  });
  const saved = (days: number[]): ScheduleOut['entries'] =>
    days.map((d, i) => ({ id: `e${i}`, day_of_week: d, on_time: '06:00', off_time: '09:00', enabled: true }));

  const mount = (data: ScheduleOut = schedule(), onDetailed = jest.fn()) =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })}>
        <SimpleScheduleEditor pump={pump} data={data} onDetailed={onDetailed} />
      </QueryClientProvider>,
    );

  const pickFromClock = (testID: string, hour: number, minute: number) => {
    fireEvent.press(screen.getByTestId(testID));
    const props = mockOpen.mock.calls[mockOpen.mock.calls.length - 1][0];
    act(() => props.onChange({ type: 'set' }, new Date(2026, 0, 1, hour, minute)));
  };

  beforeEach(() => {
    save.mockImplementation(async (_id: string, body: { enabled: boolean; entries: unknown[] }) =>
      schedule({ enabled: body.enabled, entries: body.entries.map((e, i) => ({ id: `n${i}`, ...(e as object) })) as ScheduleOut['entries'] }),
    );
  });

  it('shows a Start and a Stop card with the saved times, and the one-line summary', () => {
    mount(schedule({ entries: saved([0, 1, 2]) }));
    expect(screen.getByText('Start Time')).toBeTruthy();
    expect(screen.getByText('Stop Time')).toBeTruthy();
    expect(screen.getByTestId('schedule-start-value').props.children).toBe('06:00 AM');
    expect(screen.getByTestId('schedule-stop-value').props.children).toBe('09:00 AM');
    expect(screen.getByTestId('schedule-summary').props.children).toBe('Pump starts at 06:00 AM and stops at 09:00 AM.');
    expect(screen.getByTestId('schedule-day-mon').props.accessibilityState.checked).toBe(true);
    expect(screen.getByTestId('schedule-day-thu').props.accessibilityState.checked).toBe(false);
  });

  it('opens the phone\'s clock when a card is tapped and shows the time that was picked', () => {
    mount(schedule({ entries: saved([0]) }));
    pickFromClock('schedule-start', 7, 15);
    expect(screen.getByTestId('schedule-start-value').props.children).toBe('07:15 AM');
    expect(screen.getByTestId('schedule-summary').props.children).toBe('Pump starts at 07:15 AM and stops at 09:00 AM.');
    pickFromClock('schedule-stop', 18, 45);
    expect(screen.getByTestId('schedule-stop-value').props.children).toBe('06:45 PM');
  });

  it('keeps the old time when the clock is cancelled', () => {
    mount(schedule({ entries: saved([0]) }));
    fireEvent.press(screen.getByTestId('schedule-start'));
    act(() => mockOpen.mock.calls[0][0].onChange({ type: 'dismissed' }, new Date(2026, 0, 1, 11, 0)));
    expect(screen.getByTestId('schedule-start-value').props.children).toBe('06:00 AM');
    fireEvent.press(screen.getByTestId('schedule-save'));
    expect(screen.queryByText('Save the schedule for Borewell?')).toBeNull(); // nothing changed, nothing to save
  });

  it('refuses a stop that is not after the start, and names the problem', () => {
    mount(schedule({ entries: saved([0]) }));
    pickFromClock('schedule-stop', 5, 0);
    expect(screen.getByTestId('schedule-problem').props.children).toBe('OFF must be later than ON');
    fireEvent.press(screen.getByTestId('schedule-save'));
    expect(screen.queryByText('Save the schedule for Borewell?')).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it('needs at least one day before it can be saved', () => {
    mount();
    pickFromClock('schedule-start', 7, 0);
    expect(screen.getByTestId('schedule-no-days')).toBeTruthy();
    fireEvent.press(screen.getByTestId('schedule-save'));
    expect(save).not.toHaveBeenCalled();
  });

  it('saves the same start and stop on every chosen day, through the existing schedule call', async () => {
    mount(schedule({ enabled: false }));
    fireEvent.press(screen.getByTestId('schedule-day-mon'));
    fireEvent.press(screen.getByTestId('schedule-day-wed'));
    pickFromClock('schedule-start', 7, 0);
    pickFromClock('schedule-stop', 10, 30);
    fireEvent.press(screen.getByTestId('schedule-save'));
    expect(screen.getByText('Save the schedule for Borewell?')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('confirm-yes'));
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toBe('P1');
    expect(save.mock.calls[0][1]).toEqual({
      enabled: true,
      entries: [
        { day_of_week: 0, on_time: '07:00', off_time: '10:30', enabled: true },
        { day_of_week: 2, on_time: '07:00', off_time: '10:30', enabled: true },
      ],
    });
    expect(screen.getByText('Schedule saved.')).toBeTruthy();
  });

  it('chooses and clears every day with one tap', () => {
    mount();
    fireEvent.press(screen.getByTestId('schedule-every-day'));
    for (const d of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
      expect(screen.getByTestId(`schedule-day-${d}`).props.accessibilityState.checked).toBe(true);
    }
    fireEvent.press(screen.getByTestId('schedule-every-day'));
    expect(screen.getByTestId('schedule-day-sun').props.accessibilityState.checked).toBe(false);
  });

  it('shows the server\'s reason when saving fails, and keeps what was chosen', async () => {
    save.mockRejectedValueOnce(new Error('boom'));
    mount();
    fireEvent.press(screen.getByTestId('schedule-day-fri'));
    fireEvent.press(screen.getByTestId('schedule-save'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('confirm-yes'));
    });
    expect(screen.getByTestId('schedule-error')).toBeTruthy();
    expect(screen.queryByText('Schedule saved.')).toBeNull();
    expect(screen.getByTestId('schedule-day-fri').props.accessibilityState.checked).toBe(true);
  });

  it('offers the detailed editor for different times on different days', () => {
    const onDetailed = jest.fn();
    mount(schedule(), onDetailed);
    fireEvent.press(screen.getByTestId('schedule-detailed'));
    expect(onDetailed).toHaveBeenCalledTimes(1);
  });
});
