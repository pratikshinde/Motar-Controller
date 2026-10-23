// Scaffolds a new manufacturer's app: brands/<key>/brand.json (copied from the first brand, then edited) and the two
// EAS build profiles for it. Run: npm run brand:new -- <key> "<Display Name>" [com.company.app]
//   npm run brand:new -- swati "Swati Pump Controller" com.swati.pump
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const brands = createRequire(import.meta.url)('../brands/load.js');

const [key, displayName, pkg] = process.argv.slice(2);
if (!key || !displayName) {
  console.error('Usage: npm run brand:new -- <key> "<Display Name>" [android.package]');
  process.exit(1);
}
if (existsSync(path.join(brands.ROOT, key))) {
  console.error(`brands/${key} already exists.`);
  process.exit(1);
}

const upper = displayName.toUpperCase();
const words = upper.split(/\s+/);
const last = words.length > 1 ? words.pop() : '';
const brand = {
  key,
  appName: displayName,
  shortName: words[0],
  titleLine1: words.join(' '),
  titleLine2: last,
  colors: {},
  build: {
    slug: `${key}-pump-controller`,
    scheme: key,
    androidPackage: pkg || `com.${key}.pumpcontroller`,
    iosBundleId: pkg || `com.${key}.pumpcontroller`,
    easProjectId: null,
    icon: null,
    adaptiveIconForeground: null,
    adaptiveIconBackground: null,
    splashImage: null,
  },
};

mkdirSync(path.join(brands.ROOT, key), { recursive: true });
writeFileSync(path.join(brands.ROOT, key, 'brand.json'), JSON.stringify(brand, null, 2) + '\n');
brands.load(key); // validates what was just written

const easFile = path.join(root, 'eas.json');
const eas = JSON.parse(readFileSync(easFile, 'utf8'));
eas.build[`${key}-preview`] = { extends: 'preview', env: { BRAND: key } };
eas.build[`${key}-production`] = { extends: 'production', env: { BRAND: key } };
writeFileSync(easFile, JSON.stringify(eas, null, 2) + '\n');

console.log(`Created brands/${key}/brand.json and the ${key}-preview / ${key}-production build profiles.`);
console.log('Next: set the colours and add the logo/icon files (see brands/README.md), run `npm run a11y:contrast`,');
console.log(`then try it:  BRAND=${key} npx expo start --web   (PowerShell: $env:BRAND="${key}"; npx expo start --web)`);
