import { apiJson } from './client';
import type { ServiceReportsResponse } from '../types';

export async function fetchServiceReports(days = 30): Promise<ServiceReportsResponse> {
  return apiJson(`/service-reports?days=${days}`);
}
