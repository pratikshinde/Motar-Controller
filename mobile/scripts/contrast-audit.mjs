// WCAG contrast audit for the colours the farmer app actually puts text on (planner P3.5).
// Reads the tokens from src/shared/theme/index.ts, so a colour change that drops below the
// threshold fails CI. Normal text needs 4.5:1 (WCAG AA); large / bold display text needs 3:1.
// Run: npm run a11y:contrast
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const themeFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'shared', 'theme', 'index.ts');
const source = readFileSync(themeFile, 'utf8');

const block = (name) => {
  const m = source.match(new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\} as const;`));
  if (!m) throw new Error(`token block "${name}" not found in ${themeFile}`);
  return Object.fromEntries(
    [...m[1].matchAll(/(\w+):\s*'(#[0-9a-fA-F]{6,8})'/g)].map(([, k, v]) => [k, v.slice(0, 7)]),
  );
};
const c = block('colors');
const power = block('power');

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (fg, bg) => {
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
};

const AA = 4.5;
const LARGE = 3;
const white = '#FFFFFF';
// [foreground, background, minimum ratio, where it is used]
const pairs = [
  [c.text, c.surface, AA, 'body text on cards'],
  [c.text, c.bg, AA, 'body text on the page'],
  [c.textMuted, c.surface, AA, 'secondary text on cards'],
  [c.textMuted, c.bg, AA, 'secondary text on the page'],
  [c.textMuted, c.surfaceAlt, AA, 'secondary text on tiles'],
  [c.textFaint, c.surface, AA, 'hints and units on cards'],
  [c.textFaint, c.bg, AA, 'hints on the page'],
  [c.textFaint, c.surfaceAlt, AA, 'units on tiles'],
  [c.primary, c.surface, AA, 'links and active tab on cards'],
  [c.primary, c.primarySoft, AA, 'active tab label, Listen button'],
  [c.primary, c.bg, AA, 'links on the page'],
  [c.textOnPrimary, c.primary, AA, 'header bar and primary buttons'],
  [white, c.danger, AA, 'danger buttons'],
  [c.ok, c.okSoft, AA, 'status pill: running / fixed'],
  [c.warn, c.warnSoft, AA, 'status pill and banners: warning'],
  [c.danger, c.dangerSoft, AA, 'status pill and banners: fault'],
  [c.idle, c.idleSoft, AA, 'status pill: stopped / offline'],
  [c.ok, c.surface, AA, 'healthy text on cards'],
  [c.warn, c.surface, AA, 'warning text on cards'],
  [c.danger, c.surface, AA, 'fault text on cards'],
  [c.warn, c.accentSoft, AA, 'amber text on amber tint'],
  [c.textOnDark, c.hero, AA, 'hero title and clock'],
  [c.textOnDarkMuted, c.hero, AA, 'hero secondary text'],
  [c.textOnDarkMuted, c.heroRaised, AA, 'signal label'],
  [c.accent, c.hero, AA, 'hero sub-title and cooldown'],
  [white, c.phaseR, LARGE, 'R-phase current bar'],
  [white, c.phaseB, LARGE, 'B-phase current bar'],
  ['#3B2A00', c.phaseY, AA, 'Y-phase current bar (dark text)'],
  [c.phaseR, c.surface, LARGE, 'R voltage ring value (large bold)'],
  [c.phaseB, c.surface, LARGE, 'B voltage ring value (large bold)'],
  [c.warn, c.surface, LARGE, 'Y phase label'],
  // The power button keeps the colours farmers already know; the label under it is checked so a regression is visible.
  [power.on, c.hero, LARGE, 'power button: ON label and ring'],
  [power.off, c.hero, LARGE, 'power button: OFF label and ring'],
];

let failures = 0;
console.log('ratio  need  result  foreground -> background  (use)');
for (const [fg, bg, min, use] of pairs) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) failures += 1;
  console.log(`${r.toFixed(2).padStart(5)}  ${min.toFixed(1)}   ${ok ? 'pass  ' : 'FAIL  '}  ${fg} -> ${bg}  (${use})`);
}
console.log(failures ? `\n${failures} pair(s) below WCAG AA.` : `\nAll ${pairs.length} pairs meet WCAG AA.`);
process.exit(failures ? 1 : 0);
