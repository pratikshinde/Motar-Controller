import type { QueryClient } from '@tanstack/react-query';
import {
  getGetPumpCommandQueryKey,
  getGetPumpQueryKey,
  getGetPumpTimerQueryKey,
  getListAlertsQueryKey,
  getListPumpFaultsQueryKey,
  getListPumpsQueryKey,
} from '@/api/generated/farmer';
import type { CommandDetailResponse, PumpDetailResponse, PumpListResponse, PumpResponse } from '@/api/generated/model';
import type { RealtimeEvent } from './client';

/** Live fields the server pushes in a `telemetry` event, copied onto the cached pump. */
const LIVE_FIELDS = [
  'v_ry',
  'v_yb',
  'v_br',
  'i_r',
  'i_y',
  'i_b',
  'pump_on',
  'fault_active',
  'fault_code',
  'signal_dbm',
  'gsm_rssi',
  'status',
  'total_runtime_min',
] as const;

export function mergeTelemetry(pump: PumpResponse, data: Record<string, unknown>, nowIso: string): PumpResponse {
  const next: Record<string, unknown> = { ...pump };
  for (const key of LIVE_FIELDS) {
    // `fault_code: null` is meaningful (fault cleared); `undefined` (key absent) is not.
    if (key in data && (data[key] !== null || key === 'fault_code')) next[key] = data[key];
  }
  if (data.gsm_rssi !== undefined && data.signal_dbm === undefined) next.signal_dbm = data.gsm_rssi;
  // The reading's own timestamp when it has one, so "last reported" and command confirmation use one clock.
  next.last_seen_at = typeof data.recorded_at === 'string' ? data.recorded_at : nowIso;
  return next as unknown as PumpResponse;
}

function commandFromEvent(
  pumpId: string,
  data: Record<string, unknown>,
  old?: CommandDetailResponse,
): CommandDetailResponse {
  return {
    cid: String(data.cid ?? old?.cid ?? ''),
    pump_id: pumpId,
    command: String(data.command ?? old?.command ?? ''),
    status: String(data.status ?? old?.status ?? 'QUEUED'),
    reject_reason: (data.reject_reason as string | undefined) ?? old?.reject_reason ?? null,
    failure_reason: (data.failure_reason as string | undefined) ?? old?.failure_reason ?? null,
    payload: (data.payload as Record<string, unknown> | undefined) ?? old?.payload ?? null,
    issued_at:
      (data.created_at as string | undefined) ?? (data.issued_at as string | undefined) ?? old?.issued_at ?? null,
    sent_at: (data.sent_at as string | undefined) ?? old?.sent_at ?? null,
    delivered_at: (data.delivered_at as string | undefined) ?? old?.delivered_at ?? null,
    expires_at: (data.expires_at as string | undefined) ?? old?.expires_at ?? null,
    acked_at: (data.acked_at as string | undefined) ?? old?.acked_at ?? null,
    applied_at: (data.applied_at as string | undefined) ?? old?.applied_at ?? null,
  };
}

/** Folds one live event into the cache so every screen updates without refetching. */
export function applyRealtimeEvent(qc: QueryClient, event: RealtimeEvent, now: Date = new Date()): void {
  const { pumpId, data } = event;
  const nowIso = now.toISOString();

  switch (event.type) {
    case 'telemetry': {
      qc.setQueriesData<PumpListResponse>({ queryKey: getListPumpsQueryKey() }, (old) => {
        if (!old) return old;
        const patch = (list: PumpResponse[]) =>
          list.map((p) => (p.id === pumpId ? mergeTelemetry(p, data, nowIso) : p));
        return { ...old, pumps: patch(old.pumps), data: patch(old.data) };
      });
      qc.setQueryData<PumpDetailResponse>(getGetPumpQueryKey(pumpId), (old) => {
        if (!old) return old;
        const recorded = typeof data.recorded_at === 'string' ? data.recorded_at : nowIso;
        return {
          ...old,
          pump: mergeTelemetry(old.pump, data, nowIso),
          latest_telemetry: {
            ...(old.latest_telemetry ?? {}),
            ...(mergeTelemetry({} as PumpResponse, data, nowIso) as object),
            recorded_at: recorded,
            runtime_today_min: old.latest_telemetry?.runtime_today_min ?? null,
          },
        };
      });
      return;
    }
    case 'fault': {
      void qc.invalidateQueries({ queryKey: getListAlertsQueryKey() });
      void qc.invalidateQueries({ queryKey: getListPumpFaultsQueryKey(pumpId) });
      void qc.invalidateQueries({ queryKey: getGetPumpQueryKey(pumpId) });
      return;
    }
    case 'command': {
      const cid = String(data.cid ?? '');
      if (!cid) return;
      qc.setQueryData<CommandDetailResponse>(getGetPumpCommandQueryKey(pumpId, cid), (old) =>
        commandFromEvent(pumpId, data, old),
      );
      return;
    }
    case 'config': {
      void qc.invalidateQueries({ queryKey: getGetPumpTimerQueryKey(pumpId) });
    }
  }
}
