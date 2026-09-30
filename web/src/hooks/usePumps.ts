import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchPumps } from '../api/pumps';
import { useWs } from '../context/WebSocketContext';
import type { PumpListItem, FleetStats } from '../types';

// WebSocket (FR-WEB-005) is now the primary update channel — see
// context/WebSocketContext.tsx and backend/services/wsHub.js. This poll
// is a safety net: it picks up pumps newly in scope (WS only pushes
// updates to pumps already known to a connection) and re-syncs `stats`,
// which is computed server-side over the full scoped set and would drift
// if recomputed locally from a single paginated page.
const FALLBACK_POLL_MS = 45000;

export function usePumps(search = '') {
  const { subscribe, status: wsStatus } = useWs();
  const [pumps, setPumps] = useState<PumpListItem[]>([]);
  const [stats, setStats] = useState<FleetStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const searchRef = useRef(search);
  searchRef.current = search;

  const reload = useCallback(async () => {
    try {
      const data = await fetchPumps(searchRef.current);
      const list = data?.pumps || (data as any)?.data || [];
      setPumps(Array.isArray(list) ? list : []);
      setStats(data?.meta?.stats || null);
      setError(null);
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err.message || 'Could not load pumps');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    reload();
  }, [search, reload]);

  useEffect(() => {
    const id = setInterval(reload, FALLBACK_POLL_MS);
    return () => clearInterval(id);
  }, [reload]);

  useEffect(() => {
    return subscribe('telemetry', msg => {
      // FastAPI ws_hub shape: { type:"telemetry", pump_id:"...", data:{v_ry,v_yb,v_br,i_r,i_y,i_b,status,...} }
      const pumpId = msg.pump_id ?? msg.pump?.id;
      const src = msg.data ?? msg.pump ?? msg;
      if (!pumpId) return;
      setPumps(prev => {
        const idx = prev.findIndex(p => p.id === pumpId);
        if (idx === -1) return prev; // out of the current page/scope — next poll will pick it up
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          status: src.status ?? next[idx].status,
          v_ry: src.v_ry ?? next[idx].v_ry,
          v_yb: src.v_yb ?? next[idx].v_yb,
          v_br: src.v_br ?? next[idx].v_br,
          i_r: src.i_r ?? next[idx].i_r,
          i_y: src.i_y ?? next[idx].i_y,
          i_b: src.i_b ?? next[idx].i_b,
          gsm_rssi: src.gsm_rssi ?? next[idx].gsm_rssi,
          telemetry_recorded_at: src.recorded_at ?? next[idx].telemetry_recorded_at,
          last_seen_at: src.recorded_at ?? next[idx].last_seen_at,
        };
        return next;
      });
      setLastUpdated(new Date());
    });
  }, [subscribe]);

  return { pumps, stats, loading, error, reload, lastUpdated, wsStatus };
}
