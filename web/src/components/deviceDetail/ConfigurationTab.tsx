import React, { useState, useMemo } from 'react';
import { Box, Card, CardContent, Typography, TextField, Switch, Chip, Button, Stack } from '@mui/material';
import { setDesiredConfig } from '../../api/config';
import { useToast } from '../../context/ToastContext';
import { layerAGroups } from '../../config/layerA';
import { monoFont } from '../../theme';
import type { DeviceConfig } from '../../types';

const STATUS_COLOR: Record<DeviceConfig['status'], 'warning' | 'success' | 'error'> = {
  PENDING: 'warning',
  APPLIED: 'success',
  FAILED: 'error'
};

export const ConfigurationTab: React.FC<{ pumpId: string; initialConfig: DeviceConfig | null; onSaved: () => void }> = ({
  pumpId,
  initialConfig,
  onSaved
}) => {
  const { showToast } = useToast();
  const reported = initialConfig?.reported_json ?? {};
  const [desired, setDesired] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    const src = initialConfig?.desired_json ?? {};
    for (const [k, v] of Object.entries(src)) init[k] = String(v);
    return init;
  });
  const [saving, setSaving] = useState(false);

  const status = initialConfig?.status ?? 'PENDING';

  function setField(key: string, value: string) {
    setDesired(prev => ({ ...prev, [key]: value }));
  }

  const dirty = useMemo(() => {
    const src = initialConfig?.desired_json ?? {};
    return Object.entries(desired).some(([k, v]) => String(src[k] ?? '') !== v);
  }, [desired, initialConfig]);

  async function handleSave() {
    setSaving(true);
    try {
      const payload: Record<string, number | boolean> = {};
      for (const [k, v] of Object.entries(desired)) {
        if (v === '') continue;
        payload[k] = Number(v); // booleans travel as 0/1 on the wire (SRS §6.1), not JS true/false
      }
      await setDesiredConfig(pumpId, payload);
      showToast('Desired configuration set (pending device acknowledgement)');
      onSaved();
    } catch (err: any) {
      showToast(err.message || 'Could not save configuration', true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Configuration status
          </Typography>
          <Chip size="small" label={status} color={STATUS_COLOR[status]} />
          {initialConfig?.updated_at && (
            <Typography variant="caption" color="text.secondary">
              updated {new Date(initialConfig.updated_at).toLocaleString()}
            </Typography>
          )}
        </Box>
        <Button variant="contained" disabled={!dirty || saving} onClick={handleSave}>
          Save configuration
        </Button>
      </Box>

      {layerAGroups.map(group => (
        <Card key={group.title} elevation={1}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              {group.title}
            </Typography>
            <Stack spacing={1.5}>
              {group.fields.map(field => {
                const current = desired[field.key] ?? '';
                const reportedValue = reported[field.key];
                const isApplied = reportedValue !== undefined && String(reportedValue) === current && current !== '';
                const hasDesired = current !== '';

                return (
                  <Box
                    key={field.key}
                    sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}
                  >
                    <Box sx={{ minWidth: 200, flex: 1 }}>
                      <Typography variant="body2">{field.label}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }}>
                        {field.key}
                        {field.kind === 'number' && field.min !== undefined ? ` · ${field.min}–${field.max} ${field.unit || ''}` : ''}
                      </Typography>
                    </Box>

                    {field.kind === 'boolean' ? (
                      <Switch checked={current === '1'} onChange={e => setField(field.key, e.target.checked ? '1' : '0')} />
                    ) : (
                      <TextField
                        size="small"
                        type="number"
                        value={current}
                        onChange={e => setField(field.key, e.target.value)}
                        slotProps={{ htmlInput: { min: field.min, max: field.max } }}
                        sx={{ width: 120 }}
                      />
                    )}

                    <Box sx={{ minWidth: 140, textAlign: 'right' }}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        reported: {reportedValue !== undefined ? String(reportedValue) : 'never'}
                      </Typography>
                      {hasDesired && (
                        <Chip
                          size="small"
                          label={isApplied ? 'Applied' : 'Pending'}
                          color={isApplied ? 'success' : 'warning'}
                          variant="outlined"
                        />
                      )}
                    </Box>
                  </Box>
                );
              })}
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Box>
  );
};
