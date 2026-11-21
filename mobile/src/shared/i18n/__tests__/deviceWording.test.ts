import { deviceWording } from '../deviceWording';
import en from '../locales/en.json';

const strings = (tree: any, out: string[] = []): string[] => {
  for (const v of Object.values(tree)) (typeof v === 'string' ? out.push(v) : strings(v, out));
  return out;
};

describe('the SolarLogger wording: no "pump" anywhere', () => {
  const tree = deviceWording(en as never);

  it('changes every pump word in every English string', () => {
    const left = strings(tree).filter((s) => /pump/i.test(s));
    expect(left).toEqual([]);
  });

  it('keeps the meaning and the capitals', () => {
    const t = tree as any;
    expect(t.dashboard.powerOn).toBe('DEVICE ON');
    expect(t.pumps.title).toBe('My Devices');
    expect(t.pumps.count_other).toBe('{{count}} devices');
    expect(t.live.noDataYet).toBe('This device has not sent any reading yet.');
  });

  it('keeps every key and every placeholder', () => {
    const keys = (o: any, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [p + k] : keys(v, p + k + '.')));
    expect(keys(tree).sort()).toEqual(keys(en).sort());
    expect((tree as any).command.rejectedWhy).toContain('{{reason}}');
  });
});
