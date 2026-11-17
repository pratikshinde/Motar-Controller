import { useEffect, useRef } from 'react';
import { useWsOptional } from '../context/WebSocketContext';

const SETTLE_MS = 1500;       // several readings in a burst are one reload
const SAFETY_POLL_MS = 30000; // in case a push is missed (the socket was down for a moment)

/**
 * Reloads a page's numbers when a pump anywhere in view reports or trips, so nobody has to refresh the page by hand.
 * The push is only the signal; `load` fetches the figures the same way the page did the first time.
 */
export function useLiveRefresh(load: () => unknown) {
  const subscribe = useWsOptional()?.subscribe;
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void loadRef.current();
      }, SETTLE_MS);
    };
    const offTelemetry = subscribe?.('telemetry', soon);
    const offFault = subscribe?.('fault', soon);
    const poll = setInterval(() => void loadRef.current(), SAFETY_POLL_MS);
    return () => {
      offTelemetry?.();
      offFault?.();
      clearInterval(poll);
      if (timer) clearTimeout(timer);
    };
  }, [subscribe]);
}
