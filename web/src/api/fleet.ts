import { apiJson } from './client';
import type { FleetDashboard } from '../types';

export async function fetchFleetDashboard(): Promise<FleetDashboard> {
  return apiJson('/fleet/dashboard');
}
