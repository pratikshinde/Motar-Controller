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
  'device_type',
  'vfd_hz',
  'vfd_i_out',
  'vfd_v_ac',
  'vfd_v_dc',
  'vfd_kw',
  'vfd_status',
  'vfd_fault_code',
] as const;

export function mergeTelemetry(pump: PumpResponse, data: Record<string, unknown>, nowIso: string): PumpResponse {
  const next: Record<string, unknown> = { ...pump };
  for (const key of LIVE_FIELDS) {
    // `fault_code: null` is meaningful (fault cleared); `undefined` (key absent) is not.
    if (key in data && (data[key] !== null || key === 'fault_code')) next[key] = data[key];
  }
  if (data.vfd && typeof data.vfd === 'object') {
    const v = data.vfd as Record<string, unknown>;
    if (v.hz !== undefined) next.vfd_hz = v.hz;
    if (v.i_out !== undefined) next.vfd_i_out = v.i_out;
    if (v.v_ac !== undefined) next.vfd_v_ac = v.v_ac;
    if (v.v_dc !== undefined) next.vfd_v_dc = v.v_dc;
    if (v.kw !== undefined) next.vfd_kw = v.kw;
    if (v.status !== undefined) next.vfd_status = v.status;
    if (v.fault_code !== undefined) next.vfd_fault_code = v.fault_code;
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
