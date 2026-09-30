import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box, Typography, FormControl, InputLabel, Select, MenuItem, Card, CardContent,
  Chip, CircularProgress, TextField, IconButton, Tooltip, Collapse,
  Paper, InputAdornment, Button
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import HistoryIcon from '@mui/icons-material/HistoryToggleOff';
import SecurityIcon from '@mui/icons-material/Security';
import DevicesIcon from '@mui/icons-material/Memory';
import PeopleIcon from '@mui/icons-material/Group';
import { fetchAuditLog } from '../api/audit';
import { useToast } from '../context/ToastContext';
import { monoFont } from '../theme';
import type { AuditLogEntry } from '../types';

const ENTITY_TYPES = ['pump', 'user', 'device_config', 'fault_log', 'allocation', 'batch', 'invite'] as const;

function getActionColor(action: string): 'success' | 'info' | 'warning' | 'error' | 'default' {
  const act = action.toUpperCase();
  if (act.includes('CREATE') || act.includes('ADD') || act.includes('IMPORT')) return 'success';
  if (act.includes('DELETE') || act.includes('REVOKE') || act.includes('REMOVE')) return 'error';
  if (act.includes('ALLOCATE') || act.includes('WARRANTY') || act.includes('STAFF')) return 'warning';
  if (act.includes('UPDATE') || act.includes('SET') || act.includes('COMMAND')) return 'info';
  return 'default';
}

export const AuditLogView: React.FC = () => {
  const { showToast } = useToast();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [entityType, setEntityType] = useState<string>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAuditLog(entityType || undefined);
      const list = Array.isArray(data) ? data : (data?.entries || (data as any)?.data || []);
      setEntries(Array.isArray(list) ? list : []);
    } catch (err: any) {
      showToast(err.message || 'Could not load audit log', true);
      setEntries([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType]);

  useEffect(() => {
    load();
  }, [load]);

  const safeEntries = useMemo(() => (Array.isArray(entries) ? entries : []), [entries]);

  const filtered = useMemo(() => {
    return safeEntries.filter(e => {
      if (!search.trim()) return true;
      const needle = search.trim().toLowerCase();
      return (
        (e.entity_id || '').toLowerCase().includes(needle) ||
        (e.action || '').toLowerCase().includes(needle) ||
        (e.actor_role || '').toLowerCase().includes(needle) ||
        (e.entity_type || '').toLowerCase().includes(needle)
      );
    });
  }, [safeEntries, search]);

  const stats = useMemo(() => {
    const total = safeEntries.length;
    const deviceEvents = safeEntries.filter(e => e.entity_type === 'pump' || e.entity_type === 'device_config').length;
    const userEvents = safeEntries.filter(e => e.entity_type === 'user' || e.entity_type === 'invite' || e.entity_type === 'allocation').length;
    const batchEvents = safeEntries.filter(e => e.entity_type === 'batch').length;
    return { total, deviceEvents, userEvents, batchEvents };
  }, [safeEntries]);

  const toggleExpand = (id: number | string) => {
    setExpandedId(prev => (prev === id ? null : id));
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 2.5, overflowY: 'auto' }}>
      {/* Header Title & Subtitle */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1.5, flexShrink: 0 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800, background: 'linear-gradient(45deg, #00E676 30%, #00B0FF 90%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            System Audit &amp; Governance Log
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Immutable trace of security events, configuration modifications, user hierarchy changes, and device provisioning.
          </Typography>
        </Box>
        <Tooltip title="Refresh log feed">
          <IconButton onClick={load} color="primary" sx={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 2 }}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Summary Stat Cards Grid */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2, flexShrink: 0 }}>
        <Paper elevation={0} sx={{ p: 2, borderRadius: 3, border: '1px solid rgba(255,255,255,0.08)', bgcolor: 'background.surfaceVariant', display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'rgba(0, 230, 118, 0.15)', color: '#00E676' }}>
            <HistoryIcon fontSize="medium" />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Total Events Recorded</Typography>
            <Typography variant="h5" sx={{ fontWeight: 700, fontFamily: monoFont }}>{stats.total}</Typography>
          </Box>
        </Paper>

        <Paper elevation={0} sx={{ p: 2, borderRadius: 3, border: '1px solid rgba(255,255,255,0.08)', bgcolor: 'background.surfaceVariant', display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'rgba(0, 176, 255, 0.15)', color: '#00B0FF' }}>
            <DevicesIcon fontSize="medium" />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Device &amp; Config Audit</Typography>
            <Typography variant="h5" sx={{ fontWeight: 700, fontFamily: monoFont }}>{stats.deviceEvents}</Typography>
          </Box>
        </Paper>

        <Paper elevation={0} sx={{ p: 2, borderRadius: 3, border: '1px solid rgba(255,255,255,0.08)', bgcolor: 'background.surfaceVariant', display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'rgba(255, 171, 0, 0.15)', color: '#FFAB00' }}>
            <PeopleIcon fontSize="medium" />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">User &amp; Hierarchy Changes</Typography>
            <Typography variant="h5" sx={{ fontWeight: 700, fontFamily: monoFont }}>{stats.userEvents}</Typography>
          </Box>
        </Paper>

        <Paper elevation={0} sx={{ p: 2, borderRadius: 3, border: '1px solid rgba(255,255,255,0.08)', bgcolor: 'background.surfaceVariant', display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'rgba(213, 0, 249, 0.15)', color: '#D500F9' }}>
            <SecurityIcon fontSize="medium" />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Manufacturing Batches</Typography>
            <Typography variant="h5" sx={{ fontWeight: 700, fontFamily: monoFont }}>{stats.batchEvents}</Typography>
          </Box>
        </Paper>
      </Box>

      {/* Search and Filters Bar */}
      {/* The page's outer flex column has `overflowY: auto` on itself rather than only on the results list
          below, so when everything's natural height exceeds the viewport, flex-shrink (default on every
          flex item) squeezed this bar — with no `flexShrink: 0` to opt out — down below the height its own
          search field needs, clipping it to a thin sliver. */}
      <Card elevation={0} sx={{ p: 2, borderRadius: 3, border: '1px solid rgba(255,255,255,0.08)', bgcolor: 'background.surface', flexShrink: 0 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
          <TextField
            size="small"
            placeholder="Search by action, entity ID, or role..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon color="action" fontSize="small" />
                  </InputAdornment>
                )
              }
            }}
            sx={{ flex: 1, minWidth: 280 }}
          />
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel id="entity-type-label">Entity Category</InputLabel>
            <Select
              labelId="entity-type-label"
              label="Entity Category"
              value={entityType}
              onChange={e => setEntityType(e.target.value)}
            >
              <MenuItem value="">All Entities</MenuItem>
              {ENTITY_TYPES.map(t => (
                <MenuItem key={t} value={t}>
                  {t.toUpperCase()}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {(search || entityType) && (
            <Button
              size="small"
              onClick={() => {
                setSearch('');
                setEntityType('');
              }}
              sx={{ color: 'text.secondary' }}
            >
              Clear Filters
            </Button>
          )}
        </Box>
      </Card>

      {/* Audit Log Entries List */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {loading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', height: 200 }}>
            <CircularProgress />
          </Box>
        ) : filtered.length === 0 ? (
          <Card elevation={0} sx={{ p: 4, borderRadius: 3, border: '1px dashed rgba(255,255,255,0.15)' }}>
            <Typography color="text.secondary" align="center">
              No audit log entries found matching the filter criteria.
            </Typography>
          </Card>
        ) : (
          filtered.map(e => {
            const isExpanded = expandedId === e.id;
            const hasDetails = Boolean(e.before_json || e.after_json || (e as any).before_state || (e as any).after_state);
            const beforeState = e.before_json || (e as any).before_state;
            const afterState = e.after_json || (e as any).after_state;

            return (
              <Card
                key={e.id}
                elevation={0}
                sx={{
                  borderRadius: 2.5,
                  border: '1px solid rgba(255,255,255,0.06)',
                  bgcolor: 'background.surfaceVariant',
                  transition: 'all 0.2s ease-in-out',
                  '&:hover': { border: '1px solid rgba(0, 230, 118, 0.3)', bgcolor: 'rgba(255,255,255,0.03)' }
                }}
              >
                <CardContent sx={{ p: 2, '&:last-child': { pb: isExpanded ? 2 : 2 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', flex: 1 }}>
                      <Typography variant="caption" sx={{ fontFamily: monoFont, color: 'text.secondary', minWidth: 160 }}>
                        {new Date(e.occurred_at).toLocaleString()}
                      </Typography>
                      <Chip
                        size="small"
                        label={e.action}
                        color={getActionColor(e.action)}
                        sx={{ fontFamily: monoFont, fontWeight: 700, px: 0.5 }}
                      />
                      <Chip
                        size="small"
                        label={`${(e.entity_type || 'system').toUpperCase()} : ${e.entity_id || 'N/A'}`}
                        variant="outlined"
                        sx={{ fontFamily: monoFont }}
                      />
                      <Typography variant="body2" sx={{ color: 'text.primary', fontWeight: 500 }}>
                        by <strong style={{ color: '#00E676' }}>{e.actor_role || 'system'}</strong>
                        {e.actor_id ? ` (${e.actor_id.slice(0, 8)}...)` : ''}
                      </Typography>
                    </Box>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {e.ip && (
                        <Chip
                          size="small"
                          label={`IP: ${e.ip}`}
                          variant="outlined"
                          sx={{ fontFamily: monoFont, fontSize: '0.7rem', opacity: 0.7 }}
                        />
                      )}
                      {hasDetails && (
                        <IconButton size="small" onClick={() => toggleExpand(e.id)} sx={{ color: 'text.secondary' }}>
                          {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                        </IconButton>
                      )}
                    </Box>
                  </Box>

                  {/* Expandable JSON State Delta */}
                  {hasDetails && (
                    <Collapse in={isExpanded} timeout="auto" unmountOnExit sx={{ mt: 2 }}>
                      <Box sx={{ display: 'grid', gridTemplateColumns: beforeState && afterState ? { xs: '1fr', md: '1fr 1fr' } : '1fr', gap: 2 }}>
                        {beforeState && (
                          <Box>
                            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>
                              BEFORE STATE
                            </Typography>
                            <Paper
                              elevation={0}
                              sx={{
                                p: 1.5,
                                bgcolor: 'rgba(0,0,0,0.3)',
                                borderRadius: 2,
                                border: '1px solid rgba(255,255,255,0.05)',
                                fontFamily: monoFont,
                                fontSize: '0.75rem',
                                overflowX: 'auto',
                                color: '#FF8A80'
                              }}
                            >
                              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                {JSON.stringify(beforeState, null, 2)}
                              </pre>
                            </Paper>
                          </Box>
                        )}
                        {afterState && (
                          <Box>
                            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>
                              AFTER STATE
                            </Typography>
                            <Paper
                              elevation={0}
                              sx={{
                                p: 1.5,
                                bgcolor: 'rgba(0,0,0,0.3)',
                                borderRadius: 2,
                                border: '1px solid rgba(255,255,255,0.05)',
                                fontFamily: monoFont,
                                fontSize: '0.75rem',
                                overflowX: 'auto',
                                color: '#B9F6CA'
                              }}
                            >
                              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                {JSON.stringify(afterState, null, 2)}
                              </pre>
                            </Paper>
                          </Box>
                        )}
                      </Box>
                    </Collapse>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </Box>
    </Box>
  );
};
