import { apiJson } from './client';
import type { AlertRow, AlertSubscription } from '../types';

export interface AlertFilters {
  status?: 'open' | 'acknowledged' | 'resolved';
  severity?: string;
  pump_id?: string;
}

export async function fetchAlerts(filters: AlertFilters = {}): Promise<{ alerts: AlertRow[] }> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.pump_id) params.set('pump_id', filters.pump_id);
  const qs = params.toString();
  return apiJson(`/alerts${qs ? '?' + qs : ''}`);
}

export async function ackAlert(id: string): Promise<{ message: string; alert: AlertRow }> {
  return apiJson(`/alerts/${encodeURIComponent(id)}/ack`, { method: 'POST' });
}

export async function assignAlert(id: string, assigneeUserId: string): Promise<{ message: string; alert: AlertRow }> {
  return apiJson(`/alerts/${encodeURIComponent(id)}/assign`, {
    method: 'POST',
    body: JSON.stringify({ assignee_user_id: assigneeUserId })
  });
}

export async function resolveAlert(id: string, resolutionNote?: string): Promise<{ message: string; alert: AlertRow }> {
  return apiJson(`/alerts/${encodeURIComponent(id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ resolution_note: resolutionNote || undefined })
  });
}

export async function fetchAlertSubscriptions(): Promise<{ subscriptions: AlertSubscription[] }> {
  return apiJson('/alert-subscriptions');
}

export async function createAlertSubscription(input: {
  pump_id?: string;
  alert_type?: string;
  min_severity?: string;
  muted?: boolean;
}): Promise<{ message: string; subscription: AlertSubscription }> {
  return apiJson('/alert-subscriptions', { method: 'POST', body: JSON.stringify(input) });
}

export async function deleteAlertSubscription(id: string): Promise<{ message: string }> {
  return apiJson(`/alert-subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
