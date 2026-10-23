// Loads and validates one brand folder (brands/<key>/brand.json). Plain CommonJS so that app.config.js, the build
// scripts and the colour audit can all use it without a compile step. The app itself never imports this file: it
// reads the public half of the brand from the build (see src/config/brand.ts).
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const KEY = /^[a-z][a-z0-9-]{1,30}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Every brand key that has a folder with a brand.json, sorted. */
function listBrands() {
  return fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, d.name, 'brand.json')))
    .map((d) => d.name)
    .sort();
}

/** The brand to build: BRAND from the environment, else "ajanta" (the first brand, and what an unconfigured build is). */
function selectedKey(env = process.env) {
  return (env.BRAND || 'ajanta').trim().toLowerCase();
}

function load(key = selectedKey()) {
  if (!KEY.test(key)) throw new Error(`BRAND "${key}" is not a valid brand key (lowercase letters, digits, dashes).`);
  const file = path.join(ROOT, key, 'brand.json');
  if (!fs.existsSync(file)) {
    throw new Error(`Unknown BRAND "${key}". Known brands: ${listBrands().join(', ') || '(none)'}. Add one with: npm run brand:new -- ${key} "Display Name"`);
  }
  const brand = JSON.parse(fs.readFileSync(file, 'utf8'));
  const problems = validate(brand, key);
  if (problems.length) throw new Error(`brands/${key}/brand.json is invalid:\n  - ${problems.join('\n  - ')}`);
  return brand;
}

function validate(brand, folderKey) {
  const problems = [];
  const text = (name, value) => {
    if (typeof value !== 'string' || !value.trim()) problems.push(`"${name}" is required`);
  };
  if (brand.key !== folderKey) problems.push(`"key" must equal the folder name "${folderKey}"`);
  ['appName', 'shortName', 'titleLine1', 'titleLine2'].forEach((n) => text(n, brand[n]));
  for (const [name, value] of Object.entries(brand.colors || {})) {
    if (!HEX.test(value)) problems.push(`colors.${name} must be a #RRGGBB colour`);
  }
  const b = brand.build || {};
  ['slug', 'scheme', 'androidPackage', 'iosBundleId'].forEach((n) => text(`build.${n}`, b[n]));
  if (b.androidPackage && !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(b.androidPackage)) {
    problems.push('build.androidPackage must look like com.company.app');
  }
  if (b.scheme && !/^[a-z][a-z0-9+.-]*$/.test(b.scheme)) problems.push('build.scheme must be lowercase letters/digits');
  return problems;
}

/** What the running app may know: everything except the build-only half. */
function publicPart(brand) {
  const { build, ...rest } = brand;
  return rest;
}

/** Paths of the brand's image files that exist, relative to the mobile/ folder (a missing optional image is skipped). */
function assetPath(key, relative) {
  if (!relative) return undefined;
  const abs = path.join(ROOT, key, relative);
  if (!fs.existsSync(abs)) throw new Error(`brands/${key}: "${relative}" is listed in brand.json but the file does not exist`);
  return `./brands/${key}/${relative}`;
}

module.exports = { listBrands, selectedKey, load, validate, publicPart, assetPath, ROOT };
