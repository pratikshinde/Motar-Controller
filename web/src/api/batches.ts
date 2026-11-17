import { apiFetch, apiJson } from './client';
import type { DeviceBatch, BatchImei, BatchImeiImportResult, StarterSheetResult, StarterStationView } from '../types';

export async function fetchBatches(): Promise<{ batches: DeviceBatch[] }> {
  return apiJson('/batches');
}

export async function fetchBatchDetail(id: string): Promise<{ batch: DeviceBatch; imeis: BatchImei[] }> {
  return apiJson(`/batches/${encodeURIComponent(id)}`);
}

export async function createBatch(input: {
  batch_code: string;
  model: string;
  hw_rev?: string;
  quantity?: number;
  manufacture_date?: string;
}): Promise<{ message: string; batch: DeviceBatch }> {
  return apiJson('/batches', { method: 'POST', body: JSON.stringify(input) });
}

// `raw` is the pasted/CSV text as-is — the server does the parsing and
// validation (format, Luhn check digit, duplicates) so there is exactly one
// place that decides whether an IMEI is admissible, per Web_App_Pending_Items.md
// §5.2 ("one validation and error-report path, not two").
export async function importBatchImeis(batchId: string, raw: string): Promise<BatchImeiImportResult> {
  return apiJson(`/batches/${encodeURIComponent(batchId)}/imeis`, { method: 'POST', body: JSON.stringify({ raw }) });
}

export async function revokeBatch(batchId: string): Promise<{ message: string; batch: DeviceBatch }> {
  return apiJson(`/batches/${encodeURIComponent(batchId)}/revoke`, { method: 'POST' });
}

/** Upload the factory's sheet of starters (Excel or CSV) into a batch (created when the code is new). All or nothing: any problem saves nothing. */
export async function importStarterSheet(file: File, batchCode: string, extra: { model?: string; hw_rev?: string } = {}): Promise<StarterSheetResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('batch_code', batchCode);
  if (extra.model) form.append('model', extra.model);
  if (extra.hw_rev) form.append('hw_rev', extra.hw_rev);
  return apiJson('/batches/starters/import', { method: 'POST', body: form });
}

/** The factory station: the starter behind a scanned barcode (its starter ID or its modem IMEI). Rejects with a 404 message when it is on no sheet. */
export async function lookupStarter(code: string): Promise<StarterStationView> {
  return apiJson(`/batches/starters/lookup?code=${encodeURIComponent(code.trim())}`);
}

export async function recordStarterTest(id: number, result: 'PASS' | 'FAIL', note?: string): Promise<StarterStationView> {
  return apiJson(`/batches/starters/${id}/test`, { method: 'POST', body: JSON.stringify({ result, note: note || null }) });
}

/** Scan, then this: the pump is made and its AWS thing and certificate are made. Resolves with the one-time package (a zip holding the private key). */
export async function registerStarter(id: number): Promise<{ filename: string; blob: Blob; certificateId: string }> {
  const res = await apiFetch(`/batches/starters/${id}/register`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body && typeof body.detail === 'string' ? body.detail : '';
    throw new Error(detail || `Could not register the starter (${res.status})`);
  }
  const named = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
  return { filename: named?.[1] ?? 'starter-aws-identity.zip', blob: await res.blob(), certificateId: res.headers.get('X-Certificate-Id') || '' };
}

/** Saves a file through the browser's download. */
export function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** The empty Excel sheet with the column names, saved through the browser's download. */
export async function downloadStarterTemplate(): Promise<void> {
  const res = await apiFetch('/batches/starters/template.xlsx');
  if (!res.ok) throw new Error(`Could not download the template (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = 'starter-sheet-template.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}
