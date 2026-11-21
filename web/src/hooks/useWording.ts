import { useCallback } from 'react';
import { useBrandRules } from './useBrandRules';

const swap = (s: string) =>
  s
    .replace(/\bPUMPS\b/g, 'DEVICES').replace(/\bPUMP\b/g, 'DEVICE')
    .replace(/\bPumps\b/g, 'Devices').replace(/\bPump\b/g, 'Device')
    .replace(/\bpumps\b/g, 'devices').replace(/\bpump\b/g, 'device')
    .replace(/\bFarmers\b/g, 'Users').replace(/\bFarmer\b/g, 'User')
    .replace(/\bfarmers\b/g, 'users').replace(/\bfarmer\b/g, 'user');

/** The words of a brand where the admin has users only (SolarLogger): "device" instead of "pump" and "user" instead of "farmer". Other brands: unchanged. */
export function useWording(): (text: string) => string {
  const { usersOnly } = useBrandRules();
  return useCallback((text: string) => (usersOnly ? swap(text) : text), [usersOnly]);
}
