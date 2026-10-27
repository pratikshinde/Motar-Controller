import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PumpResponse, ScheduleOut } from '@/api/generated/model';
import i18n from '@/shared/i18n';
import * as api from '@/api/generated/farmer';
import { ScheduleEditor } from '../schedule/ScheduleScreen';
import { ContractError, validateResponse } from '@/api/http';
import { nextLabel } from '../schedule/labels';
import {
  Row, display12h, entriesFromRows, from12h, lengthOf, newRowFor, outcomeOf, to12h, validateRows,
} from '../schedule/model';

jest.mock('@/api/generated/farmer', () => ({
  ...jest.requireActual('@/api/generated/farmer'),
  useGetPumpSchedule: jest.fn(),
  setPumpSchedule: jest.fn(),
}));

beforeEach(async () => {
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  jest.clearAllMocks();
});

let n = 0;
const row = (day: number, on: string, off: string, enabled = true): Row => ({ key: `t${++n}`, day, on, off, enabled });

describe('schedule rules (the same ones the server enforces)', () => {
  it('reads a time the way a farmer does, 12-hour with AM and PM', () => {
    expect(to12h('00:00')).toEqual({ hour: 12, minute: 0, pm: false });
    expect(to12h('12:00')).toEqual({ hour: 12, minute: 0, pm: true });
    expect(to12h('13:05')).toEqual({ hour: 1, minute: 5, pm: true });
    expect(to12h('23:59')).toEqual({ hour: 11, minute: 59, pm: true });
    expect(display12h('13:05', 'AM', 'PM')).toBe('1:05 PM');
    expect(display12h('00:30', 'AM', 'PM')).toBe('12:30 AM');
  });

  it('turns 12-hour parts back into the same 24-hour time, for every minute of the day', () => {
    for (let h24 = 0; h24 < 24; h24++) {
      for (const minute of [0, 5, 30, 59]) {
        const hhmm = `${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        const p = to12h(hhmm);
        expect(from12h(p.hour, p.minute, p.pm)).toBe(hhmm);
      }
    }
  });

  it('says how long a row runs, and nothing for a row that is not valid', () => {
    expect(lengthOf('11:00', '13:00')).toEqual({ h: 2, m: 0 });
    expect(lengthOf('06:30', '07:05')).toEqual({ h: 0, m: 35 });
    expect(lengthOf('13:00', '11:00')).toBeNull();
    expect(lengthOf('11:00', '11:00')).toBeNull();
  });

  it('finds what is wrong with a row, and where', () => {
    const backwards = row(0, '13:00', '11:00');
    const tooShort = row(1, '11:00', '11:03');
    const a = row(2, '11:00', '13:00');
    const overlapping = row(2, '12:00', '14:00');
    const tooClose = row(3, '11:00', '13:00');
    const tooCloseNext = row(3, '13:02', '14:00');
    const p = validateRows([backwards, tooShort, a, overlapping, tooClose, tooCloseNext]);
    expect(p[backwards.key]).toEqual({ kind: 'order' });
    expect(p[tooShort.key]).toEqual({ kind: 'short', minutes: 5 });
    expect(p[a.key]).toBeUndefined();
    expect(p[overlapping.key]).toEqual({ kind: 'overlap' });
    expect(p[tooCloseNext.key]).toEqual({ kind: 'gap', minutes: 5 });
  });

  it('lets the same hours on different days, and rows with a proper gap, through', () => {
    const rows = [row(0, '11:00', '13:00'), row(1, '11:00', '13:00'), row(0, '13:30', '15:00')];
    expect(validateRows(rows)).toEqual({});
  });

  it('does not let a switched-off row block the others', () => {
    expect(validateRows([row(0, '11:00', '13:00'), row(0, '12:00', '14:00', false)])).toEqual({});
  });

  it('starts a new row where the day left off, and never past midnight', () => {
    expect(newRowFor(0, [])).toMatchObject({ day: 0, on: '06:00', off: '08:00' });
    expect(newRowFor(0, [row(0, '06:00', '08:00')])).toMatchObject({ on: '09:00', off: '11:00' });
    expect(newRowFor(1, [row(0, '06:00', '08:00')])).toMatchObject({ day: 1, on: '06:00' });
    const late = newRowFor(0, [row(0, '20:00', '23:00')]);
    expect(late.off > late.on).toBe(true);
    expect(validateRows([row(0, '20:00', '23:00'), late])).not.toEqual({}); // there is no room: the farmer sees why
  });

  it('sends rows in day and time order, without the screen-only keys', () => {
    const entries = entriesFromRows([row(2, '06:30', '08:00'), row(0, '17:00', '18:30'), row(0, '11:00', '13:00', false)]);
    expect(entries).toEqual([
      { day_of_week: 0, on_time: '11:00', off_time: '13:00', enabled: false },
      { day_of_week: 0, on_time: '17:00', off_time: '18:30', enabled: true },
      { day_of_week: 2, on_time: '06:30', off_time: '08:00', enabled: true },
    ]);
  });

  it('words what happened at a due time, by what the pump itself confirmed', () => {
    expect(outcomeOf('SENT', 'APPLIED')).toEqual({ key: 'done', tone: 'ok' });
    expect(outcomeOf('SENT', 'SENT')).toEqual({ key: 'sent', tone: 'info' });
    expect(outcomeOf('SENT', 'NOT_CONFIRMED')).toEqual({ key: 'notConfirmed', tone: 'warn' });
    expect(outcomeOf('ALREADY_ON', null).key).toBe('alreadyOn');
    expect(outcomeOf('SKIPPED_FAULT', null).tone).toBe('warn');
    expect(outcomeOf('MISSED', null)).toEqual({ key: 'missed', tone: 'bad' });
    expect(outcomeOf('PENDING', null).key).toBe('waiting');
  });
});

describe('what the app does with an answer it was not built for', () => {
  const good = {
    pump_id: 'P1', enabled: true, timezone: 'Asia/Kolkata',
    entries: [{ id: 'e1', day_of_week: 0, on_time: '11:00', off_time: '13:00', enabled: true }],
    next: { kind: 'START', at: '2026-10-26T05:30:00+00:00', local: 'Mon 11:00', day_of_week: 0, time: '11:00' },
    recent: [], limits: { min_window_minutes: 5, min_gap_minutes: 5, max_rows: 50 }, server_time: '2026-10-26T04:00:00+00:00',
  };

  it('checks the schedule endpoints against the contract, like every other endpoint', () => {
    expect(() => validateResponse('GET', '/pumps/P1/schedule', good)).not.toThrow();
    expect(() => validateResponse('PUT', '/pumps/P1/schedule', good)).not.toThrow();
    const oldServer = { ...good, next: { kind: 'START', at: good.next.at, local: 'Mon 11:00' } }; // no day_of_week / time
    expect(() => validateResponse('GET', '/pumps/P1/schedule', oldServer)).toThrow(ContractError);
    expect(() => validateResponse('PUT', '/pumps/P1/schedule', oldServer)).toThrow(ContractError);
  });

  it('words "next" as nothing, never as a crash, when the server did not say when', () => {
    const t = i18n.t.bind(i18n);
    expect(nextLabel(null, t)).toBeNull();
    expect(nextLabel(undefined, t)).toBeNull();
    expect(nextLabel({ kind: 'START', day_of_week: 0 } as never, t)).toBeNull();
    expect(nextLabel({ kind: 'STOP', day_of_week: 2, time: '13:30' }, t)).toBe('Next: switch OFF Wed 1:30 PM');
  });
});

describe('ScheduleEditor', () => {
  const pump = { id: 'P1', name: 'Borewell Pump', display_name: 'Borewell', lifecycle_state: 'ACTIVE' } as PumpResponse;
  const hook = api.useGetPumpSchedule as jest.Mock;
  const save = api.setPumpSchedule as jest.Mock;

  const schedule = (over: Partial<ScheduleOut> = {}): ScheduleOut => ({
    pump_id: 'P1',
    enabled: true,
    timezone: 'Asia/Kolkata',
    entries: [{ id: 'e1', day_of_week: 0, on_time: '11:00', off_time: '13:00', enabled: true }],
    next: { kind: 'START', at: '2026-10-26T05:30:00+00:00', local: 'Mon 11:00', day_of_week: 0, time: '11:00' },
    recent: [{ kind: 'START', due_at: '2026-10-19T05:30:00+00:00', local: 'Mon 11:00', day_of_week: 0, time: '11:00', outcome: 'SENT', detail: null, command_status: 'APPLIED' }],
    limits: { min_window_minutes: 5, min_gap_minutes: 5, max_rows: 50 },
    server_time: '2026-10-26T04:00:00+00:00',
    ...over,
  });

  const mount = (p: PumpResponse = pump) =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })}>
        <ScheduleEditor pump={p} />
      </QueryClientProvider>,
    );

  beforeEach(() => {
    hook.mockReturnValue({ data: schedule(), isError: false });
    save.mockImplementation(async (_id: string, body: { enabled: boolean; entries: unknown[] }) =>
      schedule({ enabled: body.enabled, entries: body.entries.map((e, i) => ({ id: `n${i}`, ...(e as object) })) as ScheduleOut['entries'] }),
    );
  });

  it('shows the saved times in the farmer\'s words, what is next, and what happened lately', () => {
    mount();
    expect(screen.getByText('11:00 AM')).toBeTruthy();
    expect(screen.getByText('1:00 PM')).toBeTruthy();
    expect(screen.getByText('Runs 2 h')).toBeTruthy();
    expect(screen.getByTestId('schedule-next').props.children).toBe('Next: switch ON Mon 11:00 AM');
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getAllByText('No times').length).toBe(6); // the six other days
  });

  it('cannot be saved until something changes', () => {
    mount();
    fireEvent.press(screen.getByTestId('schedule-save'));
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByText('Save the schedule for Borewell?')).toBeNull();
  });

  it('adds a time to a day, names the pump before saving, and sends the whole table', async () => {
    mount();
    fireEvent.press(screen.getByTestId('schedule-add-tue'));
    expect(screen.getByTestId('schedule-row-tue-0')).toBeTruthy();
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
        { day_of_week: 0, on_time: '11:00', off_time: '13:00', enabled: true },
        { day_of_week: 1, on_time: '06:00', off_time: '08:00', enabled: true },
      ],
    });
    expect(screen.getByText('Schedule saved.')).toBeTruthy();
  });

  it('sets a time with the big buttons, and refuses a row whose OFF is not after its ON', () => {
    mount();
    fireEvent.press(screen.getByTestId('schedule-on-mon-0'));
    expect(screen.getByTestId('time-preview').props.children).toBe('11:00 AM');
    fireEvent.press(screen.getByTestId('time-hour-up')); // 12
    fireEvent.press(screen.getByTestId('time-hour-up')); // 1
    fireEvent.press(screen.getByTestId('time-pm'));
    expect(screen.getByTestId('time-preview').props.children).toBe('1:00 PM');
    fireEvent.press(screen.getByTestId('time-done'));
    // ON is now 1:00 PM and OFF is still 1:00 PM
    expect(screen.getByText('OFF must be later than ON')).toBeTruthy();
    fireEvent.press(screen.getByTestId('schedule-save'));
    expect(screen.queryByText('Save the schedule for Borewell?')).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it('steps the minutes by five and wraps round the hour', () => {
    mount();
    fireEvent.press(screen.getByTestId('schedule-on-mon-0'));
    fireEvent.press(screen.getByTestId('time-minute-down'));
    expect(screen.getByTestId('time-minute-value').props.children).toBe('55');
    fireEvent.press(screen.getByTestId('time-minute-up'));
    expect(screen.getByTestId('time-minute-value').props.children).toBe('00');
    fireEvent.press(screen.getByTestId('time-cancel'));
    expect(screen.queryByTestId('time-preview')).toBeNull(); // closed without changing anything
    expect(screen.getByText('11:00 AM')).toBeTruthy();
  });

  it('removes a row, and the master switch is part of what gets saved', async () => {
    mount();
    fireEvent.press(screen.getByTestId('schedule-remove-mon-0'));
    fireEvent(screen.getByTestId('schedule-master'), 'valueChange', false);
    fireEvent.press(screen.getByTestId('schedule-save'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('confirm-yes'));
    });
    expect(save.mock.calls[0][1]).toEqual({ enabled: false, entries: [] });
  });

  it('shows an error and keeps the edits when the server refuses', async () => {
    save.mockRejectedValue({ response: { status: 422, data: {} } });
    mount();
    fireEvent.press(screen.getByTestId('schedule-add-wed'));
    fireEvent.press(screen.getByTestId('schedule-save'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('confirm-yes'));
    });
    expect(screen.getByTestId('schedule-error')).toBeTruthy();
    expect(screen.getByTestId('schedule-row-wed-0')).toBeTruthy(); // still there to fix
    expect(screen.queryByText('Schedule saved.')).toBeNull();
  });

  it('cannot be changed while remote control is paused for the pump', () => {
    mount({ ...pump, lifecycle_state: 'SUSPENDED' } as PumpResponse);
    expect(screen.getByText('The schedule cannot be changed while remote control is paused.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('schedule-add-tue'));
    expect(screen.queryByTestId('schedule-row-tue-0')).toBeNull();
    fireEvent.press(screen.getByTestId('schedule-save'));
    expect(save).not.toHaveBeenCalled();
  });

  it('has no "next" line when the schedule is switched off', () => {
    hook.mockReturnValue({ data: schedule({ enabled: false, next: null }), isError: false });
    mount();
    expect(screen.queryByTestId('schedule-next')).toBeNull();
  });
});
