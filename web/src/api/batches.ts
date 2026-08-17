import { apiJson } from './client';
import type { DeviceBatch, BatchImei, BatchImeiImportResult } from '../types';

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
