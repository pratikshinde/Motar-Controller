/**
 * Pseudo-localisation: turns the English strings into accented, longer text (for example
 * "Start the pump?" becomes "[Ŝţáŕţ ţĥé ƥûɱƥ? ~~~]"). Run the app with EXPO_PUBLIC_PSEUDO_LOCALE=1 to see it:
 * anything that is still plain English was not translated, and anything that is cut off or overflows
 * would also break in a language with longer words (Tamil, Malayalam, Kannada).
 * Placeholders such as {{name}} are left exactly as they are.
 */
const MAP: Record<string, string> = {
  a: 'á',
  b: 'ƀ',
  c: 'ç',
  d: 'ď',
  e: 'é',
  f: 'ƒ',
  g: 'ğ',
  h: 'ĥ',
  i: 'í',
  j: 'ĵ',
  k: 'ķ',
  l: 'ĺ',
  m: 'ɱ',
  n: 'ñ',
  o: 'ó',
  p: 'ƥ',
  q: 'ɋ',
  r: 'ŕ',
  s: 'ŝ',
  t: 'ţ',
  u: 'û',
  v: 'ṽ',
  w: 'ŵ',
  x: 'ẋ',
  y: 'ý',
  z: 'ž',
  A: 'Á',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Ď',
  E: 'É',
  F: 'Ƒ',
  G: 'Ğ',
  H: 'Ĥ',
  I: 'Í',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ĺ',
  M: 'Ṁ',
  N: 'Ñ',
  O: 'Ó',
  P: 'Ƥ',
  Q: 'Ɋ',
  R: 'Ŕ',
  S: 'Ŝ',
  T: 'Ţ',
  U: 'Û',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'Ẋ',
  Y: 'Ý',
  Z: 'Ž',
};

const SPLIT_PLACEHOLDERS = /(\{\{[^}]+\}\})/;
const IS_PLACEHOLDER = /^\{\{[^}]+\}\}$/;

export function pseudoLocalizeString(text: string): string {
  const body = text
    .split(SPLIT_PLACEHOLDERS)
    .map((part) => (IS_PLACEHOLDER.test(part) ? part : [...part].map((ch) => MAP[ch] ?? ch).join('')))
    .join('');
  const pad = '~'.repeat(Math.ceil(text.length * 0.35));
  return `[${body} ${pad}]`;
}

type Tree = { [key: string]: string | Tree };

export function pseudoLocalize(tree: Tree): Tree {
  const out: Tree = {};
  for (const [k, v] of Object.entries(tree))
    out[k] = typeof v === 'string' ? pseudoLocalizeString(v) : pseudoLocalize(v);
  return out;
}
