import { driveStatusKey, heroKind, VFD_DC_UNDER_VOLT } from '@/features/pump/swatiHome';
import { dayKey, sessionMinutes, sessionsFromReadings } from '@/features/history/sessions';
import { brand } from '@/config/brand';
import swati from '../../../brands/swati/brand.json';
import ajanta from '../../../brands/ajanta/brand.json';

const base = { state: 'running' as const, pending: null, isSolar: false, faultCode: null };

describe('home state (Swati)', () => {
  it('shows what the pump reported: running, stopped, offline, no data', () => {
    expect(heroKind(base)).toBe('running');
    expect(heroKind({ ...base, state: 'stopped' })).toBe('stopped');
    expect(heroKind({ ...base, state: 'offline' })).toBe('offline');
    expect(heroKind({ ...base, state: 'nodata' })).toBe('nodata');
  });

  it('a command in progress wins over the old state', () => {
    expect(heroKind({ ...base, state: 'stopped', pending: 'START' })).toBe('starting');
    expect(heroKind({ ...base, state: 'running', pending: 'STOP' })).toBe('stopping');
  });

  it('any fault is a problem to act on, except a solar drive that simply has too little sun', () => {
    expect(heroKind({ ...base, state: 'fault', faultCode: 2 })).toBe('problem');
    expect(heroKind({ ...base, state: 'fault', isSolar: true, faultCode: 103 })).toBe('problem');
    expect(heroKind({ ...base, state: 'fault', isSolar: true, faultCode: VFD_DC_UNDER_VOLT })).toBe('sunlight');
    // the same code on a mains pump is not about sunlight
    expect(heroKind({ ...base, state: 'fault', isSolar: false, faultCode: VFD_DC_UNDER_VOLT })).toBe('problem');
  });

  it('a pump that went quiet is never shown as stopped', () => {
    expect(heroKind({ ...base, state: 'offline', faultCode: VFD_DC_UNDER_VOLT, isSolar: true })).toBe('offline');
  });
});

describe('solar drive status', () => {
  it('names the statuses we know and leaves the rest to be shown as the drive sent them', () => {
    expect(driveStatusKey('RUNNING')).toBe('pumps.status.running');
    expect(driveStatusKey(' stopped ')).toBe('pumps.status.stopped');
    expect(driveStatusKey('FAULT')).toBe('pumps.status.fault');
    expect(driveStatusKey('STANDBY')).toBeNull();
    expect(driveStatusKey(null)).toBeNull();
  });
});

describe('run sessions from readings', () => {
  const minute = 60_000;
  const t0 = Date.parse('2026-10-23T06:00:00Z');
  const reading = (offsetMin: number, on = true) => ({ pump_on: on, recorded_at: new Date(t0 + offsetMin * minute).toISOString() });

  it('joins readings a minute apart into one run, with real start and stop times', () => {
    const s = sessionsFromReadings([reading(0), reading(1), reading(2), reading(3)], t0 + 60 * minute);
    expect(s).toHaveLength(1);
    expect(s[0].startMs).toBe(t0);
    expect(s[0].endMs).toBe(t0 + 3 * minute);
    expect(s[0].ongoing).toBe(false);
    expect(sessionMinutes(s[0])).toBe(4);
  });

  it('splits runs at a gap longer than five minutes and ignores readings where the pump was off', () => {
    const s = sessionsFromReadings([reading(0), reading(1), reading(2, false), reading(30), reading(31)], t0 + 90 * minute);
    expect(s.map((x) => [x.startMs, x.endMs])).toEqual([
      [t0, t0 + minute],
      [t0 + 30 * minute, t0 + 31 * minute],
    ]);
  });

  it('marks the latest run as ongoing when it is still reporting, and never invents one from nothing', () => {
    expect(sessionsFromReadings([reading(0), reading(1)], t0 + 2 * minute)[0].ongoing).toBe(true);
    expect(sessionsFromReadings([], t0)).toEqual([]);
    expect(sessionsFromReadings([reading(0, false)], t0)).toEqual([]);
  });

  it('a pump that reports itself stopped has no run still going, even if its last reading was a minute ago', () => {
    expect(sessionsFromReadings([reading(0), reading(1)], t0 + 2 * minute, false)[0].ongoing).toBe(false);
    expect(sessionsFromReadings([reading(0), reading(1)], t0 + 2 * minute, true)[0].ongoing).toBe(true);
  });

  it('does not treat daily rollups as readings', () => {
    expect(sessionsFromReadings([{ ...reading(0), source: 'daily_summary' }], t0)).toEqual([]);
  });

  it('keys a day by the local calendar date', () => {
    expect(dayKey(new Date(2026, 9, 3, 23, 59).getTime())).toBe('2026-10-03');
  });
});

describe('brand design', () => {
  it('only Swati asks for the Swati design; every other build, and the tests, use the original', () => {
    expect((swati as { design?: string }).design).toBe('swati');
    expect((ajanta as { design?: string }).design).toBeUndefined();
    expect(brand.design).toBe('classic');
  });
});
