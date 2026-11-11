/** Small colour helpers, so a shade is worked out from the brand tokens instead of being typed in again by hand. */

const channels = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (n: number): string => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0').toUpperCase();

/** The colour `t` of the way from `a` to `b` (0 = a, 1 = b). Both are "#RRGGBB". */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return `#${toHex(ar + (br - ar) * t)}${toHex(ag + (bg - ag) * t)}${toHex(ab + (bb - ab) * t)}`;
}

/** "#RRGGBB" with an opacity, as the CSS-style string React Native shadows and overlays take. */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
