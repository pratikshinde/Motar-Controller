import { useState, useEffect, useCallback, useRef } from 'react';

/** Per-pump countdown display for the server-enforced 45s command cooldown. */
export function useCooldowns() {
  const [remaining, setRemaining] = useState<Record<string, number>>({});
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    tickRef.current = setInterval(() => {
      setRemaining(prev => {
        const next: Record<string, number> = {};
        let changed = false;
        for (const [id, sec] of Object.entries(prev)) {
          if (sec > 1) {
            next[id] = sec - 1;
            changed = true;
          } else {
            changed = true; // dropped
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  const start = useCallback((pumpId: string, seconds: number) => {
    setRemaining(prev => ({ ...prev, [pumpId]: seconds }));
  }, []);

  return { remaining, start };
}
