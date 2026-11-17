import { describe, expect, it } from 'vitest';
import { pumpStatusWords } from '../platformUi';

const buckets = (o: Partial<Record<'total' | 'running' | 'stopped' | 'fault' | 'offline' | 'no_data', number>>) =>
  ({ total: 0, running: 0, stopped: 0, fault: 0, offline: 0, no_data: 0, ...o }) as any;

describe('a farmer\'s pump status in plain words', () => {
  it('names the one pump\'s state', () => {
    expect(pumpStatusWords(buckets({ total: 1, running: 1 })).text).toBe('Running');
    expect(pumpStatusWords(buckets({ total: 1, stopped: 1 })).text).toBe('Stopped');
    expect(pumpStatusWords(buckets({ total: 1, fault: 1 })).text).toBe('Fault');
    expect(pumpStatusWords(buckets({ total: 1, offline: 1 })).text).toBe('Offline');
    expect(pumpStatusWords(buckets({ total: 1, no_data: 1 })).text).toBe('No signal yet');
  });

  it('says what each state means', () => {
    expect(pumpStatusWords(buckets({ total: 1, running: 1 })).hint).toMatch(/water/i);
    expect(pumpStatusWords(buckets({ total: 1, offline: 1 })).hint).toMatch(/power/i);
  });

  it('counts several pumps in words, the most urgent state first', () => {
    const w = pumpStatusWords(buckets({ total: 3, running: 2, fault: 1 }));
    expect(w.text).toBe('1 fault · 2 running');
  });

  it('says so when there is no pump', () => {
    expect(pumpStatusWords(buckets({})).text).toBe('No pump yet');
  });
});
