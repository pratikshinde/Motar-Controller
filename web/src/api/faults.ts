import { apiJson } from './client';
import type { FaultLogEntry } from '../types';

// GET /pumps/:id/faults answers with the list itself (FaultRecordResponse[]), not `{faults: [...]}` — every
// caller used to guard against that with its own `Array.isArray(...) ? ... : data?.faults ...` fallback
// (EventsTab.tsx didn't, and crashed on `.faults` of an array whenever the Events tab was opened). Declaring
// the real shape here removes the need for that guard everywhere.
export async function fetchFaults(pumpId: string): Promise<FaultLogEntry[]> {
  return apiJson(`/pumps/${encodeURIComponent(pumpId)}/faults`);
}

export async function ackFault(pumpId: string, faultId: number, resolve = true) {
  return apiJson(`/pumps/${encodeURIComponent(pumpId)}/faults/${faultId}/ack`, {
    method: 'POST',
    body: JSON.stringify({ resolve })
  });
}
