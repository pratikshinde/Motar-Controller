import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Chip, CircularProgress, InputAdornment, Paper, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useTheme } from '@mui/material/styles';
import { fetchAuditLog } from '../api/audit';
import { ROLE_NAMES } from '../api/users';
import { useToast } from '../context/ToastContext';
import { auditNeedsAttention, auditText } from '../utils/auditText';
import { timeAgo } from '../utils/timeAgo';
import type { AuditLogEntry, RoleTier } from '../types';

const WHO: Record<string, string> = { operator: 'Server operator' };
const who = (role: string | null) => (role ? WHO[role] || ROLE_NAMES[role as RoleTier] || role : '');

const GROUPS = [
  { key: '', label: 'Everything' },
  { key: 'user', label: 'People' },
  { key: 'pump', label: 'Pumps' },
  { key: 'allocation', label: 'Stock' }
] as const;

/** Who did what, and when: the most recent actions first. */
export const AuditLogView: React.FC = () => {
  const theme = useTheme();
  const { showToast } = useToast();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [group, setGroup] = useState<string>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAuditLog(group || undefined);
      const list = Array.isArray(data) ? data : data?.entries || (data as any)?.data || [];
      setEntries(Array.isArray(list) ? list : []);
      setFailed('');
    } catch (err: any) {
      setFailed(err?.message || 'Could not load the activity');
      showToast(err?.message || 'Could not load the activity', true);
      setEntries([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group]);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = [...entries].sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
    if (!q) return list;
    return list.filter(e => `${auditText(e.action)} ${who(e.actor_role)} ${e.entity_id}`.toLowerCase().includes(q));
  }, [entries, search]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Typography variant="body2" color="text.secondary">
        Who did what, and when. The newest first.
      </Typography>

      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1.5 }}>
        <ToggleButtonGroup value={group} exclusive size="small" onChange={(_, v: string | null) => v !== null && setGroup(v)}>
          {GROUPS.map(g => (
            <ToggleButton key={g.key} value={g.key} data-testid={`group-${g.key || 'all'}`}>
              {g.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <TextField
          size="small"
          placeholder="Search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          sx={{ flex: '1 1 220px', maxWidth: 360 }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
        />
      </Stack>

      {failed && <Alert severity="error">{failed}</Alert>}
      {loading ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
          <CircularProgress size={36} />
        </Box>
      ) : shown.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 6, textAlign: 'center' }} data-testid="no-activity">
          {search ? 'Nothing matches that search.' : 'Nothing has happened yet.'}
        </Typography>
      ) : (
        <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
          {shown.map((e, i) => {
            const warn = auditNeedsAttention(e.action);
            return (
              <Stack
                key={e.id}
                direction="row"
                spacing={1.5}
                data-testid={`entry-${e.id}`}
                sx={{ px: 2, py: 1.25, alignItems: 'center', borderTop: i === 0 ? 0 : `1px solid ${theme.palette.divider}`, flexWrap: 'wrap', rowGap: 0.5 }}
              >
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: warn ? 'warning.main' : 'success.main', flexShrink: 0 }} />
                <Typography sx={{ fontWeight: 600, flex: '1 1 220px' }}>{auditText(e.action)}</Typography>
                {e.actor_role && <Chip size="small" variant="outlined" label={who(e.actor_role)} sx={{ height: 22 }} />}
                <Tooltip title={new Date(e.occurred_at).toLocaleString()}>
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 96, textAlign: 'right' }}>
                    {timeAgo(e.occurred_at)}
                  </Typography>
                </Tooltip>
              </Stack>
            );
          })}
        </Paper>
      )}
    </Box>
  );
};
