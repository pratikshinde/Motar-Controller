import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import i18n from '@/shared/i18n';
import { FAULT_CODES } from '@/features/faults/info';
import { friendlyError, cooldownSecondsFrom } from '../errors';
import { formatMinutes, formatReading, timeAgo } from '../format';
import { intlLocale, LANGUAGES } from '../languages';
import { pseudoLocalize, pseudoLocalizeString } from '../pseudo';

const localesDir = path.join(__dirname, '..', 'locales');
type Tree = { [k: string]: string | Tree };
const flatten = (o: Tree, p = ''): [string, string][] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' ? flatten(v, `${p}${k}.`) : [[`${p}${k}`, v] as [string, string]],
  );
const load = (file: string) => new Map(flatten(JSON.parse(readFileSync(path.join(localesDir, file), 'utf8'))));
const placeholders = (s: string) =>
  [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');

describe('locale files', () => {
  const en = load('en.json');
  const files = readdirSync(localesDir).filter((f) => f.endsWith('.json') && f !== 'en.json');

  it('one file per language on the picker', () => {
    expect(files.map((f) => f.replace('.json', '')).sort()).toEqual(
      LANGUAGES.map((l) => l.code)
        .filter((c) => c !== 'en')
        .sort(),
    );
  });

  it.each(files)('%s has exactly the keys of English, non-empty, with the same placeholders', (file) => {
    const other = load(file);
    expect([...other.keys()].sort()).toEqual([...en.keys()].sort());
    for (const [key, value] of en) {
      const translated = other.get(key)!;
      expect(translated.trim()).not.toBe('');
      expect(placeholders(translated)).toBe(placeholders(value));
    }
  });

  it.each(files.concat('en.json'))('%s explains every fault code (name, cause, what to do)', (file) => {
    const t = load(file);
    for (const code of FAULT_CODES) {
      for (const key of [`faults.code${code}`, `faultInfo.code${code}.cause`, `faultInfo.code${code}.action`]) {
        expect(t.get(key)).toBeTruthy();
      }
    }
  });
});

describe('pseudo-locale', () => {
  it('keeps {{placeholders}} exactly and makes text longer', () => {
    const out = pseudoLocalizeString('Start {{name}} now, {{count}} times');
    expect(out).toContain('{{name}}');
    expect(out).toContain('{{count}}');
    expect(out.length).toBeGreaterThan('Start {{name}} now, {{count}} times'.length * 1.3);
    expect(out).not.toContain('Start');
  });
  it('transforms a whole tree', () => {
    const t = pseudoLocalize({ a: { b: 'Hello {{who}}' }, c: 'Yes' });
    expect((t.a as Tree).b).toContain('{{who}}');
    expect(t.c).not.toBe('Yes');
  });
  it('is a valid Intl locale for date formatting', () => {
    expect(() => new Date().toLocaleDateString(intlLocale('pseudo'))).not.toThrow();
  });
});

describe('friendlyError', () => {
  const t = i18n.getFixedT('en');
  const http = (status: number, error?: object) => ({ response: { status, data: { error }, headers: {} } });
  it('never shows server text: it maps status and code to a sentence', () => {
    expect(friendlyError(http(401), t, 'login')).toBe(t('errors.wrongPassword'));
    expect(friendlyError(http(401), t, 'load')).toBe(t('errors.sessionExpired'));
    expect(friendlyError(http(403, { code: 'DEVICE_SUSPENDED' }), t, 'command')).toBe(t('errors.deviceSuspended'));
    expect(friendlyError(http(409, { code: 'SITE_NAME_EXISTS' }), t)).toBe(t('errors.siteExists'));
    expect(friendlyError(http(500), t)).toBe(t('errors.server'));
    expect(friendlyError(http(429, { code: 'COOLDOWN_ACTIVE', params: { seconds: 31 } }), t)).toBe(
      t('command.cooldown', { seconds: 31 }),
    );
  });
  it('a contract failure has its own message', () => {
    expect(friendlyError(Object.assign(new Error('x'), { name: 'ContractError' }), t)).toBe(t('errors.contract'));
  });
  it('no response at all reads as a connection problem', () => {
    expect(friendlyError(new Error('Network Error'), t)).toBe(t('errors.network'));
  });
  it('the server-requested cooldown comes from the body, then from Retry-After', () => {
    expect(cooldownSecondsFrom(http(429, { code: 'COOLDOWN_ACTIVE', params: { seconds: 12 } }))).toBe(12);
    expect(
      cooldownSecondsFrom({
        response: { status: 429, headers: { 'retry-after': '20' }, data: { error: { code: 'COOLDOWN_ACTIVE' } } },
      }),
    ).toBe(20);
    expect(cooldownSecondsFrom(http(429, { code: 'RATE_LIMIT_EXCEEDED' }))).toBeNull();
  });
});

describe('formatting never invents a value', () => {
  const t = i18n.getFixedT('en');
  it('missing readings are dashes, not zeros', () => {
    expect(formatReading(null)).toBe('—');
    expect(formatReading(undefined)).toBe('—');
    expect(formatReading(0)).toBe('0.0');
    expect(formatMinutes(t, null)).toBe('—');
    expect(formatMinutes(t, 0)).toBe('0 min');
  });
  it('minutes and hours', () => {
    expect(formatMinutes(t, 45)).toBe('45 min');
    expect(formatMinutes(t, 125)).toBe('2 h 5 min');
  });
  it('time ago', () => {
    const now = Date.parse('2026-05-10T12:00:00Z');
    expect(timeAgo(t, null, now)).toBe('Never');
    expect(timeAgo(t, '2026-05-10T11:59:40Z', now)).toBe('just now');
    expect(timeAgo(t, '2026-05-10T11:55:00Z', now)).toBe('5 min ago');
    expect(timeAgo(t, '2026-05-10T09:00:00Z', now)).toBe('3 h ago');
    expect(timeAgo(t, '2026-05-07T12:00:00Z', now)).toBe('3 days ago');
  });
});
