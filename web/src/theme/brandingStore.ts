// FR-WEB-036 white-labelling needs the resolved partner seed color inside
// ColorModeContext, which sits OUTSIDE AuthProvider in the provider tree
// (it themes the pre-login screen too, so it can't be nested inside auth).
// Rather than restructure that nesting, this is a tiny external store —
// the same module-level-variable-plus-subscribers shape api/client.ts
// already uses for the auth token — that BrandingProvider (inside
// AuthProvider) writes to and ColorModeContext (outside it) reads from.
type Listener = () => void;

let seed: string | null = null;
const listeners = new Set<Listener>();

export function setBrandingSeed(next: string | null) {
  if (next === seed) return;
  seed = next;
  listeners.forEach(l => l());
}

export function getBrandingSeed() {
  return seed;
}

export function subscribeBrandingSeed(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
