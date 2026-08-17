import { apiJson } from './client';
import type { AuditLogEntry } from '../types';

// entity_type is the only server-side filter GET /api/audit-log supports
// today (server.js) — no actor/date-range filtering exists yet, so the
// frontend doesn't offer controls for filters the backend can't apply.
export async function fetchAuditLog(entityType?: string): Promise<{ count: number; entries: AuditLogEntry[] }> {
  const q = entityType ? `/audit-log?entity_type=${encodeURIComponent(entityType)}` : '/audit-log';
  return apiJson(q);
}
