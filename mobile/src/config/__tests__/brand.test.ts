/* eslint-disable @typescript-eslint/no-require-imports */
import { brand } from '../brand';
import { colors, baseColors } from '@/shared/theme';
import { http } from '@/api/http';

const loader = require('../../../brands/load');

describe('brand', () => {
  it('a build with no brand in it is the first brand', () => {
    expect(brand.key).toBe('ajanta');
    expect(brand.appName).toBe('Ajanta Pump Controller');
  });

  it('every brand folder is valid and has its own package id, scheme and slug', () => {
    const keys: string[] = loader.listBrands();
    expect(keys.length).toBeGreaterThan(0);
    const seen = { android: new Set<string>(), ios: new Set<string>(), scheme: new Set<string>(), slug: new Set<string>() };
    for (const key of keys) {
      const b = loader.load(key); // throws with the reason when invalid
      expect(b.key).toBe(key);
      for (const [set, value] of [
        [seen.android, b.build.androidPackage],
        [seen.ios, b.build.iosBundleId],
        [seen.scheme, b.build.scheme],
        [seen.slug, b.build.slug],
      ] as const) {
        expect(set.has(value)).toBe(false); // two brands must never share a store identity
        set.add(value);
      }
    }
  });

  it('only the public half of a brand reaches the app', () => {
    const publicPart = loader.publicPart(loader.load('ajanta'));
    expect(publicPart).not.toHaveProperty('build');
    expect(brand).not.toHaveProperty('build');
  });

  it('the loader refuses a malformed brand', () => {
    expect(loader.validate({ key: 'x', appName: '', shortName: 'X', titleLine1: 'X', titleLine2: 'Y', colors: { primary: 'green' }, build: {} }, 'x')).toEqual(
      expect.arrayContaining(['"appName" is required', 'colors.primary must be a #RRGGBB colour', '"build.slug" is required']),
    );
    expect(() => loader.load('../etc')).toThrow(/not a valid brand key/);
    expect(() => loader.load('no-such-brand')).toThrow(/Unknown BRAND/);
  });

  it('the palette is the base palette plus the brand overrides', () => {
    for (const name of Object.keys(baseColors) as (keyof typeof baseColors)[]) {
      expect(colors[name]).toBe(brand.colors[name] ?? baseColors[name]);
    }
  });

  it('every request says which brand the app is', () => {
    expect(http.defaults.headers['X-App-Brand']).toBe(brand.key);
  });
});
