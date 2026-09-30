import { useEffect, useState, useSyncExternalStore } from 'react';
import { onlineManager } from '@tanstack/react-query';

/** True while the phone has a working internet connection (via NetInfo, wired in api/lifecycle). */
export const useOnline = (): boolean =>
  useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  );

/** The current time, re-read every `intervalMs`, for "2 min ago" text and countdowns. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
