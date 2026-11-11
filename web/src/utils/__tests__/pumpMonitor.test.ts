import { describe, expect, it } from 'vitest';
import { faultKind, faultText, formatHM, formatMinutes, gsmLevel, heardAgo } from '../pumpMonitor';

describe('the starter\'s fault wording', () => {
  it('uses the starter\'s own names', () => {
    expect(faultText(6).name).toBe('Cable open');
    expect(faultText(5).name).toBe('Dry Run Fault');
    expect(faultText(4).name).toBe('Line reverse: interchange R and B');
    expect(faultText(2).name).toBe('Phase Fail');
  });

  it('says whether it is a voltage or a current fault', () => {
    for (const code of [1, 2, 3, 4, 10]) expect(faultKind(code)).toBe('voltage');
    for (const code of [5, 6, 7, 8, 9]) expect(faultKind(code)).toBe('current');
    expect(faultKind(null)).toBeNull();
    expect(faultKind(99)).toBeNull();
  });

  it('never invents a name for a code it does not know', () => {
    expect(faultText(99).name).toBe('Fault 99');
    expect(faultText(null).name).toBe('Fault');
  });

  it('tells a voltage fault that clears by itself from a current fault that needs a reset', () => {
    expect(faultText(3).action).toMatch(/clears by itself/);
    expect(faultText(6).action).toMatch(/reset/);
  });
});

describe('GSM signal bars', () => {
  it.each([
    [-70, 4], [-89, 4], [-90, 3], [-97, 3], [-98, 2], [-105, 2], [-106, 1], [-112, 1], [-113, 0], [0, 0],
  ])('%i dBm is %i bars', (dbm, bars) => {
    expect(gsmLevel(dbm).bars).toBe(bars);
  });

  it('is no bars when there is no reading', () => {
    expect(gsmLevel(null).bars).toBe(0);
    expect(gsmLevel(undefined).quality).toBe('none');
  });
});

describe('run time and last heard', () => {
  it('writes minutes and hours the way the app does', () => {
    expect(formatMinutes(0)).toBe('0 min');
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(125)).toBe('2 h 05 min');
    expect(formatMinutes(null)).toBe('—');
    expect(formatHM(412)).toBe('6:52');
    expect(formatHM(null)).toBe('—');
  });

  it('says how long ago a pump was heard from', () => {
    const now = new Date('2026-11-11T10:00:00Z').getTime();
    const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();
    expect(heardAgo(ago(3), now)).toBe('just now');
    expect(heardAgo(ago(45), now)).toBe('45 s ago');
    expect(heardAgo(ago(180), now)).toBe('3 min ago');
    expect(heardAgo(ago(2 * 3600), now)).toBe('2 h ago');
    expect(heardAgo(ago(3 * 86400), now)).toBe('3 d ago');
    expect(heardAgo(null, now)).toBe('never');
  });
});
