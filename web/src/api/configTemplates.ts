import { apiJson } from './client';
import type { ConfigTemplate, ConfigTemplateApplyResult } from '../types';

export async function fetchConfigTemplates(): Promise<{ templates: ConfigTemplate[] }> {
  return apiJson('/config-templates');
}

export async function createConfigTemplate(input: {
  name: string;
  description?: string;
  desired_json: Record<string, number | boolean>;
}): Promise<{ message: string; template: ConfigTemplate }> {
  return apiJson('/config-templates', { method: 'POST', body: JSON.stringify(input) });
}

export async function updateConfigTemplate(
  id: string,
  input: { name?: string; description?: string; desired_json?: Record<string, number | boolean> }
): Promise<{ message: string; template: ConfigTemplate }> {
  return apiJson(`/config-templates/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) });
}

export async function deleteConfigTemplate(id: string): Promise<{ message: string }> {
  return apiJson(`/config-templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function applyConfigTemplate(id: string, pumpIds: string[]): Promise<ConfigTemplateApplyResult> {
  return apiJson(`/config-templates/${encodeURIComponent(id)}/apply`, {
    method: 'POST',
    body: JSON.stringify({ pump_ids: pumpIds })
  });
}
