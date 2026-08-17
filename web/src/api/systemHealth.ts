import { apiJson } from './client';
import type { SystemHealth } from '../types';

export async function fetchSystemHealth(): Promise<SystemHealth> {
  return apiJson('/system/health');
}
