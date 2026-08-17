import { apiJson } from './client';
import type { FaultLogEntry } from '../types';

export async function fetchFaults(pumpId: string): Promise<{ pump_id: string; count: number; faults: FaultLogEntry[] }> {
  return apiJson(`/pumps/${encodeURIComponent(pumpId)}/faults`);
}

export async function ackFault(pumpId: string, faultId: number, resolve = true) {
  return apiJson(`/pumps/${encodeURIComponent(pumpId)}/faults/${faultId}/ack`, {
    method: 'POST',
    body: JSON.stringify({ resolve })
  });
}
