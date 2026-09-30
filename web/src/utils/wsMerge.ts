import type { PumpListItem, TelemetryRow } from '../types';

/**
 * The WS `telemetry` payload is PumpListItem-shaped (fetchPumpBroadcastRow
 * in server.js mirrors the W0 LATERAL join), which doesn't carry
 * `pump_on`/`fault_active`/`seq` the way a raw telemetry_history row does
 * — those aren't needed for the fleet list this payload was designed for.
 * Reconstructed here as a best-effort TelemetryRow for live chart/tile
 * updates; pump_on/fault_active are inferred from `status` rather than
 * carried directly, which is accurate for display but not a substitute
 * for the real columns if something ever needs them for logic.
 */
export function pumpUpdateToTelemetryRow(pump: PumpListItem): TelemetryRow | null {
  if (!pump.telemetry_recorded_at) return null;
  return {
    recorded_at: pump.telemetry_recorded_at,
    v_ry: pump.v_ry,
    v_yb: pump.v_yb,
    v_br: pump.v_br,
    i_r: pump.i_r,
    i_y: pump.i_y,
    i_b: pump.i_b,
    gsm_rssi: pump.gsm_rssi,
    pump_on: pump.status === 'RUNNING',
    fault_active: pump.status === 'FAULT',
    seq: null,
    ts_approx: Boolean(pump.ts_approx),
    buffered: Boolean(pump.buffered)
  };
}
