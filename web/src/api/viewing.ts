// Which manufacturer's portal the platform owner (super admin) is looking at, or none (the platform itself).
//
// While one is chosen every API request carries `X-View-Manufacturer: <key>` and the live-update socket is opened for
// that manufacturer, so the existing pages show that manufacturer's pumps, farmers, alerts and numbers and nothing of any
// other manufacturer. The server only honours it for the super admin and makes it read-only (see
// backend/app/services/view_as.py). The choice lives in sessionStorage: it belongs to this browser tab only and
// disappears with it, so a forgotten selection can never follow someone into another session.
import { useSyncExternalStore } from 'react';

export interface ViewedManufacturer {
  key: string;
  name: string;
  color?: string | null;
}

const STORE_KEY = 'agripump_viewing';
const listeners = new Set<() => void>();

function read(): ViewedManufacturer | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed.key === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

let current: ViewedManufacturer | null = read();

export function getViewing(): ViewedManufacturer | null {
  return current;
}

export function setViewing(next: ViewedManufacturer | null): void {
  if ((next?.key ?? null) === (current?.key ?? null)) return;
  current = next;
  try {
    if (next) sessionStorage.setItem(STORE_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(STORE_KEY);
  } catch {
    // Storage blocked: the choice simply lasts until the page is reloaded.
  }
  listeners.forEach(cb => cb());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** The manufacturer being viewed (re-renders when it changes), or null. */
export function useViewing(): ViewedManufacturer | null {
  return useSyncExternalStore(subscribe, getViewing, getViewing);
}
