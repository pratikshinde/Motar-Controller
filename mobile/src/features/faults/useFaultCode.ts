import { useListPumpFaults } from '@/api/generated/farmer';
import type { PumpResponse } from '@/api/generated/model';
import { hasKnownFault } from '@/features/pumps/model';

type FaultPump = Pick<PumpResponse, 'id' | 'fault_code' | 'fault_active' | 'status' | 'last_seen_at' | 'pump_on'>;

/** A trip marks the pump as seen at the moment it is written, so the record that belongs to it is within this of the pump's last report. */
const SAME_TRIP_MS = 5 * 60 * 1000;

const time = (iso: string | null | undefined): number => Date.parse(iso ?? '') || 0;

/**
 * The pump's fault code. A trip reaches the server the moment it happens and marks the pump as faulted, but the code only
 * rides along with the pump's next status reading, which can be minutes later. While the pump is faulted without a code,
 * the open fault record (written at the moment of the trip) is read instead, every few seconds. Nothing is guessed: an
 * open record from an earlier time is not this trip, and with no code and no matching record this is null.
 */
export function useFaultCode(pump: FaultPump, now: number): number | null {
  const missing = hasKnownFault(pump, now) && !pump.fault_code;
  const q = useListPumpFaults(pump.id, { status: 'open' }, { query: { enabled: missing, refetchInterval: 3000 } });

  if (pump.fault_code) return pump.fault_code;
  if (!missing) return null;
  const since = time(pump.last_seen_at) - SAME_TRIP_MS;
  const newest = (q.data ?? [])
    .filter((f) => !f.resolved_at && !!f.fault_code && time(f.occurred_at) >= since)
    .sort((a, b) => time(b.occurred_at) - time(a.occurred_at))[0];
  return newest?.fault_code ?? null;
}
