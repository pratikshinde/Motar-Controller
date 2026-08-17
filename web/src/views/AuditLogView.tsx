import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, FormControl, InputLabel, Select, MenuItem, Card, CardContent,
  Chip, CircularProgress, TextField
} from '@mui/material';
import { fetchAuditLog } from '../api/audit';
import { useToast } from '../context/ToastContext';
import { monoFont } from '../theme';
import type { AuditLogEntry } from '../types';

// The only server-side filter GET /api/audit-log supports (server.js);
// these are the only entity_type values any writeAudit call actually uses.
const ENTITY_TYPES = ['pump', 'user', 'device_config', 'fault_log'] as const;

export const AuditLogView: React.FC = () => {
  const { showToast } = useToast();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [entityType, setEntityType] = useState<string>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAuditLog(entityType || undefined);
      setEntries(data.entries);
    } catch (err: any) {
      showToast(err.message || 'Could not load audit log', true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType]);

  useEffect(() => {
    load();
  }, [load]);

  // Client-side, since the API doesn't support actor/entity-id search server-side.
  const filtered = entries.filter(e => {
    if (!search.trim()) return true;
    const needle = search.trim().toLowerCase();
    return e.entity_id.toLowerCase().includes(needle) || e.action.toLowerCase().includes(needle) || (e.actor_role || '').toLowerCase().includes(needle);
  });

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
        <Typography variant="h4">Audit Log</Typography>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <TextField
            size="small"
            placeholder="Filter by entity ID, action, or role…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            sx={{ minWidth: 260 }}
          />
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel id="entity-type-label">Entity type</InputLabel>
            <Select labelId="entity-type-label" label="Entity type" value={entityType} onChange={e => setEntityType(e.target.value)}>
              <MenuItem value="">All</MenuItem>
              {ENTITY_TYPES.map(t => (
                <MenuItem key={t} value={t}>
                  {t}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {loading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', height: '100%' }}>
            <CircularProgress />
          </Box>
        ) : filtered.length === 0 ? (
          <Typography color="text.secondary">No audit entries match.</Typography>
        ) : (
          filtered.map(e => (
            <Card key={e.id} elevation={0} sx={{ bgcolor: 'background.surfaceVariant', border: 'none' }}>
              <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', '&:last-child': { pb: 1.5 } }}>
                <Typography variant="caption" sx={{ fontFamily: monoFont, minWidth: 150 }} color="text.secondary">
                  {new Date(e.occurred_at).toLocaleString()}
                </Typography>
                <Chip size="small" label={e.action} sx={{ fontFamily: monoFont, fontWeight: 700 }} />
                <Chip size="small" label={`${e.entity_type}:${e.entity_id}`} variant="outlined" sx={{ fontFamily: monoFont }} />
                <Typography variant="body2" color="text.secondary">
                  by {e.actor_role || 'system'}
                </Typography>
                {e.ip && (
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont, ml: 'auto' }}>
                    {e.ip}
                  </Typography>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </Box>
    </Box>
  );
};
