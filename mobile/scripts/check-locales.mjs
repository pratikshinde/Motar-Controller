// Fails (exit 1) if any launch language is missing a key, has an extra key,
// has an empty value, or uses different {{placeholders}} than English.
// Run: npm run i18n:check
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'shared', 'i18n', 'locales');

const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]],
  );

const load = (file) => new Map(flatten(JSON.parse(readFileSync(path.join(dir, file), 'utf8'))));
const placeholders = (s) =>
  [...String(s).matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');

const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
if (!files.includes('en.json')) throw new Error('en.json (the source language) is missing');

const base = load('en.json');
let problems = 0;
const report = (lang, msg) => {
  problems += 1;
  console.error(`  ✗ [${lang}] ${msg}`);
};

for (const file of files.filter((f) => f !== 'en.json')) {
  const lang = file.replace('.json', '');
  const other = load(file);
  for (const [key, enValue] of base) {
    if (!other.has(key)) {
      report(lang, `missing key: ${key}`);
      continue;
    }
    const value = other.get(key);
    if (typeof value !== 'string' || value.trim() === '') report(lang, `empty value: ${key}`);
    else if (placeholders(value) !== placeholders(enValue))
      report(lang, `placeholders differ in ${key}: en={${placeholders(enValue)}} ${lang}={${placeholders(value)}}`);
  }
  for (const key of other.keys()) if (!base.has(key)) report(lang, `extra key not in en.json: ${key}`);
}

console.log(
  `Checked ${files.length} locales (${files.map((f) => f.replace('.json', '')).join(', ')}), ${base.size} keys each.`,
);
if (problems) {
  console.error(`\n${problems} problem(s).`);
  process.exit(1);
}
console.log('All locales are complete.');
