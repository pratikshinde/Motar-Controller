import { apiJson } from './client';
import type { BrandingConfig } from '../types';

export interface BrandingInput {
  logo_url?: string;
  primary_color: string;
  notification_sender_name?: string;
  subdomain?: string;
}

export async function fetchResolvedBranding(): Promise<{ branding: BrandingConfig | null }> {
  return apiJson('/branding/resolve');
}

export async function fetchMyBranding(): Promise<{ branding: BrandingConfig | null }> {
  return apiJson('/branding/mine');
}

export async function setMyBranding(input: BrandingInput): Promise<{ message: string; branding: BrandingConfig }> {
  return apiJson('/branding/mine', { method: 'PUT', body: JSON.stringify(input) });
}

export async function fetchUserBranding(userId: string): Promise<{ branding: BrandingConfig | null }> {
  return apiJson(`/branding/${encodeURIComponent(userId)}`);
}

export async function setUserBranding(userId: string, input: BrandingInput): Promise<{ message: string; branding: BrandingConfig }> {
  return apiJson(`/branding/${encodeURIComponent(userId)}`, { method: 'PUT', body: JSON.stringify(input) });
}
