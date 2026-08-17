import { apiJson } from './client';
import type { DeviceConfig } from '../types';

export async function fetchDeviceConfig(pumpId: string): Promise<{ pump_id: string; config: DeviceConfig }> {
  return apiJson(`/pumps/${encodeURIComponent(pumpId)}/config`);
}

export async function setDesiredConfig(
  pumpId: string,
  desired: Record<string, number | boolean>
): Promise<{ message: string; config: DeviceConfig }> {
  return apiJson(`/pumps/${encodeURIComponent(pumpId)}/config`, {
    method: 'PUT',
    body: JSON.stringify({ desired })
  });
}
