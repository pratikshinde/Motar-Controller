import { apiFetch, apiJson, messageFrom } from './client';
import type {
  PumpsResponse,
  PumpListItem,
  CommandRecord,
  PumpDetail,
  TelemetryRow,
  LifecycleState,
  PumpProvenance,
  PanelBinding,
  McuSwapHistory,
  BridgeSwapResult
} from '../types';

export async function fetchPumps(search = ''): Promise<PumpsResponse> {
  const q = `/pumps?page=1&limit=50${search ? '&search=' + encodeURIComponent(search) : ''}`;
  const res = await apiJson<PumpsResponse>(q);
  // The latest reading's own timestamp is what says "this pump has reported"; the API calls it `recorded_at`.
  const rows = (res.pumps || (res as any).data || []).map((p: any) => ({
    ...p,
    telemetry_recorded_at: p.telemetry_recorded_at ?? p.recorded_at ?? null
  }));
  return { ...res, pumps: rows };
}

export async function fetchPumpDetail(id: string): Promise<PumpDetail> {
  return apiJson(`/pumps/${encodeURIComponent(id)}`);
}

export async function fetchPumpProvenance(id: string): Promise<PumpProvenance> {
  return apiJson(`/pumps/${encodeURIComponent(id)}/provenance`);
}

export async function setPumpWarranty(id: string, warrantyStartDate: string | null, warrantyPeriodMonths: number | null) {
  return apiJson(`/pumps/${encodeURIComponent(id)}/warranty`, {
    method: 'PUT',
    body: JSON.stringify({ warranty_start_date: warrantyStartDate, warranty_period_months: warrantyPeriodMonths })
  });
}

export async function fetchPumpTelemetry(id: string, hours = 24): Promise<{ pump_id: string; count: number; telemetry: TelemetryRow[] }> {
  return apiJson(`/pumps/${encodeURIComponent(id)}/telemetry?hours=${hours}&limit=2000`);
}

export async function createPump(input: {
  id?: string;
  name: string;
  supply_type: '3-phase' | '1-phase';
  hp_rating: number;
  latitude?: number;
  longitude?: number;
}): Promise<{ message: string; pump: PumpListItem; device_key: string }> {
  return apiJson('/pumps', { method: 'POST', body: JSON.stringify(input) });
}

export async function updatePumpLocation(id: string, latitude: number, longitude: number) {
  return apiJson(`/pumps/${encodeURIComponent(id)}/location`, {
    method: 'POST',
    body: JSON.stringify({ latitude, longitude })
  });
}

export async function deletePump(id: string) {
  const res = await apiFetch(`/pumps/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const body = await res.json();
  if (!res.ok) throw new Error(messageFrom(body, 'Delete failed'));
  return body;
}

export interface DispatchResult {
  ok: boolean;
  status: number;
  command?: CommandRecord;
  cooldownSec?: number;
  remainingSec?: number;
  message?: string;
  error?: string;
  detail?: string;
}

export async function dispatchCommand(pumpId: string, action: 'START' | 'STOP'): Promise<DispatchResult> {
  const res = await apiFetch(`/pumps/${encodeURIComponent(pumpId)}/command`, {
    method: 'POST',
    body: JSON.stringify({ command: action, action })
  });
  const body = await res.json();
  return { ok: res.ok, status: res.status, ...body };
}

export async function setLifecycleState(pumpId: string, toState: LifecycleState) {
  return apiJson(`/pumps/${encodeURIComponent(pumpId)}/lifecycle`, {
    method: 'PUT',
    body: JSON.stringify({ lifecycle_state: toState })
  });
}

export interface BulkAllocateResult {
  message: string;
  results: { pump_id: string; success: boolean; reason?: string }[];
}

export async function bulkAllocatePumps(pumpIds: string[], toUserId: string, note?: string): Promise<BulkAllocateResult> {
  return apiJson('/pumps/bulk-allocate', {
    method: 'POST',
    body: JSON.stringify({ pump_ids: pumpIds, to_user_id: toUserId, note })
  });
}

// FR-WEB-031 panel binding
export async function setPumpPanel(id: string, panel: PanelBinding): Promise<{ message: string; pump: PanelBinding & { id: string } }> {
  return apiJson(`/pumps/${encodeURIComponent(id)}/panel`, { method: 'PUT', body: JSON.stringify(panel) });
}

// FR-WEB-034 MCU (controller) swap — routine fitted-component replacement,
// history-only, no identity change.
export async function fetchMcuSwapHistory(id: string): Promise<McuSwapHistory> {
  return apiJson(`/pumps/${encodeURIComponent(id)}/mcu-swap-history`);
}

export async function postMcuSwap(id: string, newMcuUid: string, reason?: string) {
  return apiJson(`/pumps/${encodeURIComponent(id)}/mcu-swap`, {
    method: 'POST',
    body: JSON.stringify({ new_mcu_uid: newMcuUid, reason: reason || undefined })
  });
}

// FR-WEB-034 bridge (modem) swap — the rare, superadmin-only RMA/warranty
// case where the whole IMEI-identified device is replaced but site history
// (telemetry/faults/config/commands/allocation) must carry over onto the
// new identity via the pumps.id PK rename (ON UPDATE CASCADE).
export async function postBridgeSwap(id: string, newImei: string, reason?: string): Promise<BridgeSwapResult> {
  return apiJson(`/pumps/${encodeURIComponent(id)}/bridge-swap`, {
    method: 'POST',
    body: JSON.stringify({ new_imei: newImei, reason: reason || undefined })
  });
}
