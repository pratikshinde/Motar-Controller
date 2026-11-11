import { colors, power } from '../index';
import { mix, rgba } from '../color';
import { scene } from '../scene';

/** The hue of a "#RRGGBB" colour in degrees (0 to 360). */
const hue = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

describe('the Ajanta violet theme', () => {
  it('takes its palette from the brand file, in one place', () => {
    expect(colors.primary).toBe('#7053B8');
    expect(colors.primaryDark).toBe('#563B99');
    expect(colors.primarySoft).toBe('#E9DFFF');
    expect(colors.bg).toBe('#F7F4FC');
    expect(colors.surface).toBe('#FFFFFF');
    expect(colors.text).toBe('#28213B');
    expect(colors.textMuted).toBe('#665F73');
    expect(colors.border).toBe('#E9E3F1');
  });

  it('works the painted header out from those tokens, so nothing is typed in twice', () => {
    expect(scene.skyTop).toBe(colors.primaryDark);
    expect(scene.skyMid).toBe(colors.primary);
    expect(scene.skyLow).toBe(colors.primarySoft);
    for (const shade of [scene.hillFar, scene.fieldTop, scene.fieldBottom, scene.pumpLight]) {
      const h = hue(shade);
      expect(h).toBeGreaterThan(240);
      expect(h).toBeLessThan(290); // violet
    }
  });

  it('keeps the pump status colours as they were: violet never means a pump state', () => {
    expect(hue(colors.ok)).toBeGreaterThan(100); // green
    expect(hue(colors.ok)).toBeLessThan(160);
    expect(hue(colors.danger)).toBeGreaterThan(330); // red
    expect(hue(colors.warn)).toBeGreaterThan(20); // amber
    expect(hue(colors.warn)).toBeLessThan(50);
    expect(colors.idle).toBe('#5E6472'); // grey
    expect(power).toMatchObject({ on: '#00e676', off: '#ff1744' });
  });

  it('mixes and fades colours', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mix('#112233', '#112233', 0.7)).toBe('#112233');
    expect(rgba('#563B99', 0.1)).toBe('rgba(86, 59, 153, 0.1)');
  });
});
