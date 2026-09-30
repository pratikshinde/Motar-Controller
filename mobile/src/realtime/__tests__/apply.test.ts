import { QueryClient } from '@tanstack/react-query';
import {
  getGetPumpCommandQueryKey,
  getGetPumpQueryKey,
  getListAlertsQueryKey,
  getListPumpsQueryKey,
} from '@/api/generated/farmer';
import type { CommandDetailResponse, PumpDetailResponse, PumpListResponse, PumpResponse } from '@/api/generated/model';
import { applyRealtimeEvent, mergeTelemetry } from '../apply';

const pump = (over: Partial<PumpResponse> = {}): PumpResponse =>
  ({
    id: 'P1',
    name: 'Borewell',
    supply_type: '3-phase',
    hierarchy_path: '/x',
    latitude: 0,
    longitude: 0,
    status: 'STOPPED',
    lifecycle_state: 'ACTIVE',
    pump_on: false,
    fault_active: false,
    fault_code: null,
    v_ry: 400,
    last_seen_at: '2026-01-01T00:00:00Z',
    ...over,
  }) as PumpResponse;

const NOW = new Date('2026-01-01T10:00:00Z');

describe('mergeTelemetry', () => {
  it('copies the live fields and stamps last_seen_at from the reading itself', () => {
    const next = mergeTelemetry(
      pump(),
      { pump_on: true, v_ry: 412.5, recorded_at: '2026-01-01T09:59:30Z' },
      NOW.toISOString(),
    );
    expect(next.pump_on).toBe(true);
    expect(next.v_ry).toBe(412.5);
    expect(next.last_seen_at).toBe('2026-01-01T09:59:30Z');
    expect(next.name).toBe('Borewell');
  });

  it('falls back to the receive time when the reading has no timestamp', () => {
    expect(mergeTelemetry(pump(), { v_ry: 1 }, NOW.toISOString()).last_seen_at).toBe(NOW.toISOString());
  });

  it('a cleared fault (fault_code null) clears it, but a missing key changes nothing', () => {
    const faulted = pump({ fault_code: 2, fault_active: true });
    expect(mergeTelemetry(faulted, { fault_code: null, fault_active: false }, NOW.toISOString()).fault_code).toBeNull();
    expect(mergeTelemetry(faulted, { v_ry: 1 }, NOW.toISOString()).fault_code).toBe(2);
  });

  it('does not overwrite a value with null (a reading that lacks a field is not a zero)', () => {
    expect(mergeTelemetry(pump({ v_ry: 400 }), { v_ry: null }, NOW.toISOString()).v_ry).toBe(400);
  });

  it('mirrors gsm_rssi into signal_dbm when only the old name is sent', () => {
    expect(mergeTelemetry(pump(), { gsm_rssi: -77 }, NOW.toISOString()).signal_dbm).toBe(-77);
  });
});

describe('applyRealtimeEvent', () => {
  const setup = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    const list: PumpListResponse = {
      pumps: [pump(), pump({ id: 'P2', name: 'Other' })],
      data: [pump(), pump({ id: 'P2', name: 'Other' })],
      meta: { total: 2, limit: 50 },
    };
    const detail: PumpDetailResponse = {
      pump: pump(),
      latest_telemetry: { runtime_today_min: 42 },
      open_fault_count: 0,
    };
    qc.setQueryData(getListPumpsQueryKey(), list);
    qc.setQueryData(getGetPumpQueryKey('P1'), detail);
    return qc;
  };

  it('updates only the addressed pump, in the list and the detail, and keeps runtime_today_min', () => {
    const qc = setup();
    applyRealtimeEvent(qc, { type: 'telemetry', pumpId: 'P1', data: { pump_on: true, v_ry: 415, i_r: 12 } }, NOW);
    const list = qc.getQueryData<PumpListResponse>(getListPumpsQueryKey())!;
    expect(list.pumps[0]).toMatchObject({ pump_on: true, v_ry: 415, i_r: 12 });
    expect(list.data[0].pump_on).toBe(true);
    expect(list.pumps[1].pump_on).toBe(false);
    const detail = qc.getQueryData<PumpDetailResponse>(getGetPumpQueryKey('P1'))!;
    expect(detail.pump.pump_on).toBe(true);
    expect(detail.latest_telemetry?.v_ry).toBe(415);
    expect(detail.latest_telemetry?.runtime_today_min).toBe(42);
  });

  it('does nothing for a pump that is not cached', () => {
    const qc = setup();
    applyRealtimeEvent(qc, { type: 'telemetry', pumpId: 'NOPE', data: { pump_on: true } }, NOW);
    expect(qc.getQueryData(getGetPumpQueryKey('NOPE'))).toBeUndefined();
  });

  it('a fault event refreshes alerts and the pump instead of guessing', () => {
    const qc = setup();
    const spy = jest.spyOn(qc, 'invalidateQueries');
    applyRealtimeEvent(qc, { type: 'fault', pumpId: 'P1', data: {} }, NOW);
    const keys = spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    expect(keys).toContain(JSON.stringify(getListAlertsQueryKey()));
    expect(keys).toContain(JSON.stringify(getGetPumpQueryKey('P1')));
  });

  it('a command event creates and then updates that command in the cache', () => {
    const qc = setup();
    applyRealtimeEvent(
      qc,
      {
        type: 'command',
        pumpId: 'P1',
        data: { cid: 'C1', command: 'STOP', status: 'QUEUED', created_at: '2026-01-01T09:00:00Z' },
      },
      NOW,
    );
    applyRealtimeEvent(
      qc,
      { type: 'command', pumpId: 'P1', data: { cid: 'C1', status: 'ACKNOWLEDGED', acked_at: '2026-01-01T09:00:05Z' } },
      NOW,
    );
    const cmd = qc.getQueryData<CommandDetailResponse>(getGetPumpCommandQueryKey('P1', 'C1'))!;
    expect(cmd).toMatchObject({
      cid: 'C1',
      command: 'STOP',
      status: 'ACKNOWLEDGED',
      issued_at: '2026-01-01T09:00:00Z',
      acked_at: '2026-01-01T09:00:05Z',
    });
  });
});
