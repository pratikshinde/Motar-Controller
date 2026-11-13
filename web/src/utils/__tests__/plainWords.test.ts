import { describe, expect, it } from 'vitest';
import { timeAgo } from '../timeAgo';
import { auditNeedsAttention, auditText } from '../auditText';

const NOW = new Date('2026-11-13T12:00:00Z').getTime();
const before = (ms: number) => new Date(NOW - ms).toISOString();

describe('how long ago, in words', () => {
  it('says just now, minutes, hours and days, with the right plural', () => {
    expect(timeAgo(before(20_000), NOW)).toBe('just now');
    expect(timeAgo(before(60_000), NOW)).toBe('1 minute ago');
    expect(timeAgo(before(5 * 60_000), NOW)).toBe('5 minutes ago');
    expect(timeAgo(before(3_600_000), NOW)).toBe('1 hour ago');
    expect(timeAgo(before(3 * 3_600_000), NOW)).toBe('3 hours ago');
    expect(timeAgo(before(86_400_000), NOW)).toBe('1 day ago');
    expect(timeAgo(before(5 * 86_400_000), NOW)).toBe('5 days ago');
  });

  it('gives the date after a month, and nothing for nothing', () => {
    expect(timeAgo(before(90 * 86_400_000), NOW)).toMatch(/2026/);
    expect(timeAgo(null, NOW)).toBe('');
    expect(timeAgo('not a date', NOW)).toBe('');
  });

  it('never says a time in the future', () => {
    expect(timeAgo(new Date(NOW + 60_000).toISOString(), NOW)).toBe('just now');
  });
});

describe('the activity log in words', () => {
  it('turns the codes we know into sentences', () => {
    expect(auditText('USER_CREATED')).toBe('Added an account');
    expect(auditText('farmer_registered')).toBe('Registered a farmer');
    expect(auditText('BULK_ALLOCATE')).toBe('Gave starters to someone');
  });

  it('turns a code it does not know into words rather than showing the code', () => {
    expect(auditText('TEST_ERASURE')).toBe('Test erasure');
    expect(auditText('')).toBe('Something happened');
  });

  it('marks the ones worth a second look', () => {
    for (const a of ['LOGIN_FAILED', 'DELETE_PUMP', 'FARMER_STOPPED', 'ACCOUNT_SUSPENDED', 'MFA_DISABLED']) expect(auditNeedsAttention(a)).toBe(true);
    for (const a of ['USER_CREATED', 'LOGIN_SUCCESS']) expect(auditNeedsAttention(a)).toBe(false);
  });
});
