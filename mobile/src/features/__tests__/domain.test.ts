import type { HistoryPoint, PumpResponse } from '@/api/generated/model';
import { commandProgress, isFinished } from '../commands/progress';
import { faultInfoKeys, FAULT_CODES, isKnownFault } from '../faults/info';
import { dailyBars, hourlyBars, sumMinutes } from '../history/buckets';
import {
  groupBySite,
  hasKnownFault,
  isKnownHealthy,
  isSuspended,
  phaseIndicator,
  planState,
  pumpState,
  signalBars,
} from '../pumps/model';
import { clampTo, parseTimer, timerMode, timerToRequest } from '../timer/validation';

const NOW = Date.parse('2026-05-10T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

describe('pumpState: what is shown is what the server really said', () => {
  it('a pump that never reported is "no data", not stopped', () => {
    expect(pumpState({ last_seen_at: null, status: 'STOPPED', pump_on: false, fault_active: false }, NOW)).toBe(
      'nodata',
    );
  });
  it('a pump quiet for more than 10 minutes is offline, even if its last status was RUNNING', () => {
    expect(pumpState({ last_seen_at: ago(11 * MIN), status: 'RUNNING', pump_on: true, fault_active: false }, NOW)).toBe(
      'offline',
    );
  });
  it('running / stopped / fault while it is reporting', () => {
    const base = { last_seen_at: ago(MIN), fault_active: false };
    expect(pumpState({ ...base, status: 'RUNNING', pump_on: true }, NOW)).toBe('running');
    expect(pumpState({ ...base, status: 'STOPPED', pump_on: false }, NOW)).toBe('stopped');
    expect(pumpState({ ...base, status: 'STOPPED', pump_on: false, fault_active: true }, NOW)).toBe('fault');
    expect(pumpState({ ...base, status: 'FAULT', pump_on: false }, NOW)).toBe('fault');
  });
});

describe('a quiet pump is never called healthy', () => {
  const faultedThenQuiet = { last_seen_at: ago(3 * 60 * MIN), status: 'FAULT', pump_on: false, fault_active: true };
  it('keeps showing the last known fault', () => expect(hasKnownFault(faultedThenQuiet, NOW)).toBe(true));
  it('is not healthy', () => expect(isKnownHealthy(faultedThenQuiet, NOW)).toBe(false));
  it('an offline pump that had no fault is neither faulted nor healthy', () => {
    const quiet = { last_seen_at: ago(3 * 60 * MIN), status: 'STOPPED', pump_on: false, fault_active: false };
    expect(hasKnownFault(quiet, NOW)).toBe(false);
    expect(isKnownHealthy(quiet, NOW)).toBe(false);
  });
  it('a reporting pump with no fault is healthy', () => {
    expect(isKnownHealthy({ last_seen_at: ago(MIN), status: 'RUNNING', pump_on: true, fault_active: false }, NOW)).toBe(
      true,
    );
  });
});

describe('phase order indicator is only claimed when it can be derived', () => {
  it('fault 4 is wrong rotation', () =>
    expect(phaseIndicator({ pump_on: false, fault_active: true, fault_code: 4 })).toBe('wrong'));
  it('running without a fault is fine', () =>
    expect(phaseIndicator({ pump_on: true, fault_active: false, fault_code: null })).toBe('ok'));
  it('stopped, unknown or another fault says nothing', () => {
    expect(phaseIndicator({ pump_on: false, fault_active: false, fault_code: null })).toBeNull();
    expect(phaseIndicator({ pump_on: null, fault_active: null, fault_code: null })).toBeNull();
    expect(phaseIndicator({ pump_on: false, fault_active: true, fault_code: 5 })).toBeNull();
  });
});

describe('signal bars', () => {
  it('unknown signal has no bars and no claim', () => expect(signalBars(null)).toBeNull());
  it('maps dBm to 0-5', () => {
    expect(signalBars(-115)).toBe(0);
    expect(signalBars(-95)).toBe(1);
    expect(signalBars(-70)).toBe(3);
    expect(signalBars(-40)).toBe(5);
  });
});

describe('plan state', () => {
  const day = 24 * 60 * MIN;
  const at = (ms: number) => new Date(NOW + ms).toISOString();
  it('nothing tracked = nothing shown', () =>
    expect(planState({ lifecycle_state: 'ACTIVE', subscription_expires_at: null }, NOW)).toEqual({ kind: 'none' }));
  it('more than 7 days left is fine', () =>
    expect(planState({ lifecycle_state: 'ACTIVE', subscription_expires_at: at(20 * day) }, NOW).kind).toBe('ok'));
  it('warns from 7 days before', () => {
    const p = planState({ lifecycle_state: 'ACTIVE', subscription_expires_at: at(7 * day - 1000) }, NOW);
    expect(p.kind).toBe('expiring');
    expect(p.kind === 'expiring' && p.daysLeft).toBe(7);
    expect(planState({ lifecycle_state: 'ACTIVE', subscription_expires_at: at(8 * day + 1000) }, NOW).kind).toBe('ok');
  });
  it('a plan ending in a few hours counts as 1 day, then expired', () => {
    const soon = planState({ lifecycle_state: 'ACTIVE', subscription_expires_at: at(3 * 60 * MIN) }, NOW);
    expect(soon.kind === 'expiring' && soon.daysLeft).toBe(1);
    expect(planState({ lifecycle_state: 'ACTIVE', subscription_expires_at: at(-1000) }, NOW).kind).toBe('expired');
  });
  it('suspended devices are explained whatever the plan says', () => {
    expect(planState({ lifecycle_state: 'SUSPENDED', subscription_expires_at: at(30 * day) }, NOW)).toEqual({
      kind: 'suspended',
    });
    expect(isSuspended({ lifecycle_state: 'rma' })).toBe(true);
    expect(isSuspended({ lifecycle_state: 'ACTIVE' })).toBe(false);
  });
});

describe('grouping', () => {
  const p = (id: string, site?: string) =>
    ({ id, site_id: site ? `s-${site}` : null, site_name: site ?? null }) as unknown as PumpResponse;
  it('named groups alphabetically, ungrouped last, order inside preserved', () => {
    const sections = groupBySite([p('1'), p('2', 'West'), p('3', 'East'), p('4', 'West')]);
    expect(sections.map((s) => s.title)).toEqual(['East', 'West', null]);
    expect(sections[1].pumps.map((x) => x.id)).toEqual(['2', '4']);
  });
  it('no groups at all is one untitled section', () => {
    const sections = groupBySite([p('1'), p('2')]);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBeNull();
  });
});

describe('command progress: a step is ticked only when it happened', () => {
  const base = { issuedAtMs: NOW, waitedMs: 5_000, expectedPumpOn: false };
  it('just sent: only "sent"', () => {
    expect(commandProgress({ ...base, status: 'QUEUED' })).toEqual({ kind: 'inProgress', reached: 0 });
    // The server handing it to the network says nothing about the pump: not "reached the pump".
    expect(commandProgress({ ...base, status: 'SENT' })).toEqual({ kind: 'inProgress', reached: 0 });
  });
  it('delivered and acknowledged advance it', () => {
    expect(commandProgress({ ...base, status: 'DELIVERED' })).toEqual({ kind: 'inProgress', reached: 1 });
    expect(commandProgress({ ...base, status: 'ACKNOWLEDGED' })).toEqual({ kind: 'inProgress', reached: 2 });
    expect(commandProgress({ ...base, status: 'SENT', deliveredAt: '2026-01-01' })).toEqual({
      kind: 'inProgress',
      reached: 1,
    });
    expect(commandProgress({ ...base, status: 'SENT', ackedAt: '2026-01-01' })).toEqual({
      kind: 'inProgress',
      reached: 2,
    });
  });
  it('60 s without an answer is "not confirmed", not failed', () => {
    const p = commandProgress({ ...base, status: 'PENDING', waitedMs: 61_000 });
    expect(p).toEqual({ kind: 'notConfirmed', reached: 0 });
    expect(isFinished(p)).toBe(false);
  });
  it('an acknowledged command is never called "not confirmed"', () => {
    expect(commandProgress({ ...base, status: 'ACKNOWLEDGED', waitedMs: 300_000 }).kind).toBe('inProgress');
  });
  it('when the server says it could not confirm, believe it at once and keep what did happen', () => {
    expect(commandProgress({ ...base, status: 'NOT_CONFIRMED' })).toEqual({ kind: 'notConfirmed', reached: 0 });
    expect(commandProgress({ ...base, status: 'NOT_CONFIRMED', deliveredAt: '2026-01-01' })).toEqual({
      kind: 'notConfirmed',
      reached: 1,
    });
  });
  it('a command the server could not send is finished, and is not blamed on the pump', () => {
    const p = commandProgress({ ...base, status: 'FAILED', waitedMs: 1_000 });
    expect(p).toEqual({ kind: 'notSent' });
    expect(isFinished(p)).toBe(true);
  });
  it('the server saying APPLIED is done', () => {
    expect(commandProgress({ ...base, status: 'APPLIED' })).toEqual({ kind: 'done' });
  });
  it('done only when the pump itself reports the new state after the command', () => {
    const done = commandProgress({ ...base, status: 'PENDING', pumpOn: false, lastReadingAtMs: NOW + 3_000 });
    expect(done).toEqual({ kind: 'done' });
    // an OLD reading that happens to match is not proof
    expect(commandProgress({ ...base, status: 'PENDING', pumpOn: false, lastReadingAtMs: NOW - 60_000 }).kind).toBe(
      'inProgress',
    );
    // the wrong state is not proof either
    expect(commandProgress({ ...base, status: 'PENDING', pumpOn: true, lastReadingAtMs: NOW + 3_000 }).kind).toBe(
      'inProgress',
    );
  });
  it('rejections and expiries keep their reason', () => {
    expect(commandProgress({ ...base, status: 'REJECTED', rejectReason: 'FAULT_ACTIVE' })).toEqual({
      kind: 'rejected',
      reason: 'FAULT_ACTIVE',
    });
    expect(commandProgress({ ...base, status: 'EXPIRED' }).kind).toBe('expired');
    expect(isFinished({ kind: 'rejected', reason: null })).toBe(true);
  });
});

describe('timer validation', () => {
  it('accepts the panel limits at both ends', () => {
    expect(parseTimer({ on: '1', off: '0', cycles: '0' }).ok).toBe(true);
    expect(parseTimer({ on: '250', off: '250', cycles: '999' }).ok).toBe(true);
  });
  it('flags exactly the fields that are out of range', () => {
    const r = parseTimer({ on: '0', off: '251', cycles: '1000' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors).toEqual({ on: true, off: true, cycles: true });
    expect(parseTimer({ on: '', off: '5', cycles: '1' })).toEqual({ ok: false, errors: { on: true } });
    expect(parseTimer({ on: '5.5', off: '5', cycles: '1' }).ok).toBe(false);
    expect(parseTimer({ on: '-3', off: '5', cycles: '1' }).ok).toBe(false);
  });
  it('run once vs run / rest cycles, and the request body the server expects', () => {
    expect(timerMode({ on: 30, off: 0, cycles: 1 })).toBe('ON_TIMER');
    expect(timerMode({ on: 30, off: 10, cycles: 1 })).toBe('ON_TIMER');
    expect(timerMode({ on: 30, off: 10, cycles: 0 })).toBe('CYCLIC');
    expect(timerToRequest({ on: 30, off: 10, cycles: 3 })).toEqual({
      on_duration_minutes: 30,
      off_duration_minutes: 10,
      cycle_count: 3,
      mode: 'CYCLIC',
    });
    expect(clampTo(300, { min: 1, max: 250 })).toBe(250);
    expect(clampTo(-4, { min: 0, max: 250 })).toBe(0);
  });
});

describe('history buckets', () => {
  const row = (iso: string, on: boolean): HistoryPoint => ({ recorded_at: iso, pump_on: on, source: 'raw' });
  it('counts running readings per hour over the last 24 hours, capped at 60', () => {
    const now = Date.parse('2026-05-10T12:30:00Z');
    const rows: HistoryPoint[] = [];
    for (let m = 0; m < 70; m++)
      rows.push(row(new Date(Date.parse('2026-05-10T10:00:00Z') + m * 40_000).toISOString(), true));
    rows.push(row('2026-05-10T11:20:00Z', false)); // stopped rows do not count
    rows.push(row('2026-05-08T00:00:00Z', true)); // older than 24 h is dropped
    const bars = hourlyBars(rows, now);
    expect(bars).toHaveLength(24);
    expect(bars[bars.length - 1].startMs).toBe(Date.parse('2026-05-10T12:00:00Z'));
    expect(sumMinutes(bars)).toBeGreaterThan(0);
    expect(sumMinutes(bars)).toBeLessThanOrEqual(70);
    expect(Math.max(...bars.map((b) => b.minutes))).toBeLessThanOrEqual(60);
  });
  it('daily rollups become sorted bars with starts and fault counts', () => {
    const rows = [
      { recorded_at: '2026-05-09', source: 'daily_summary', runtime_min: 120, start_count: 2, fault_count: 0 },
      { recorded_at: '2026-05-08', source: 'daily_summary', runtime_min: 60, start_count: 1, fault_count: 1 },
      { recorded_at: '2026-05-07T10:00:00Z', source: 'raw', pump_on: true },
    ] as HistoryPoint[];
    const bars = dailyBars(rows);
    expect(bars.map((b) => b.day)).toEqual(['2026-05-08', '2026-05-09']);
    expect(sumMinutes(bars)).toBe(180);
    expect(bars[0]).toMatchObject({ starts: 1, faults: 1 });
  });
});

describe('fault information', () => {
  it('has a cause / action pair for every code the panel can raise', () => {
    for (const code of FAULT_CODES) {
      expect(isKnownFault(code)).toBe(true);
      expect(faultInfoKeys(code).cause).toBe(`faultInfo.code${code}.cause`);
    }
  });
  it('an unknown or missing code still gets a sensible message', () => {
    expect(faultInfoKeys(99)).toEqual({ cause: 'faultInfo.unknown.cause', action: 'faultInfo.unknown.action' });
    expect(faultInfoKeys(null).cause).toBe('faultInfo.unknown.cause');
  });
});
