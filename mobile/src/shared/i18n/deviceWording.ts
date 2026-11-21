/**
 * For a brand whose product is a logger on a solar drive (SolarLogger) nothing in the app is called a "pump": it says "device".
 * Applies to the English strings (the brand's `features.deviceWording`); the wording of the other languages is theirs.
 */
function swap(text: string): string {
  return text
    .replace(/\bPUMPS\b/g, 'DEVICES')
    .replace(/\bPUMP\b/g, 'DEVICE')
    .replace(/\bPumps\b/g, 'Devices')
    .replace(/\bPump\b/g, 'Device')
    .replace(/\bpumps\b/g, 'devices')
    .replace(/\bpump\b/g, 'device')
    .replace(/\bPump(['’]s)\b/g, 'Device$1')
    .replace(/\bpump(['’]s)\b/g, 'device$1');
}

type Tree = { [key: string]: string | Tree };

/** A copy of the translation tree with every "pump" word changed to "device" (keys are left as they are). */
export function deviceWording(tree: Tree): Tree {
  const out: Tree = {};
  for (const [key, value] of Object.entries(tree)) {
    out[key] = typeof value === 'string' ? swap(value) : deviceWording(value);
  }
  return out;
}
