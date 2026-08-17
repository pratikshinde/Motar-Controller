import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box, Typography, Card, CardContent, Button, TextField, Switch, Stack,
  CircularProgress, Chip, IconButton, Tooltip, Divider
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/DeleteOutlineOutlined';
import { fetchConfigTemplates, createConfigTemplate, deleteConfigTemplate } from '../api/configTemplates';
import { useToast } from '../context/ToastContext';
import { layerAGroups } from '../config/layerA';
import { monoFont } from '../theme';
import type { ConfigTemplate } from '../types';

// FR-WEB-032 — named, reusable sets of layer-A desired-config keys
// (Web_App_Pending_Items.md §6). Uses the same authoritative key list as
// the device Configuration tab so a template can never reference a key
// the firmware doesn't understand.
export const ConfigTemplatesView: React.FC = () => {
  const { showToast } = useToast();
  const [templates, setTemplates] = useState<ConfigTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchConfigTemplates();
      setTemplates(data.templates);
    } catch (err: any) {
      showToast(err.message || 'Could not load templates', true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function setField(key: string, value: string) {
    setFields(prev => ({ ...prev, [key]: value }));
  }

  const includedCount = useMemo(() => Object.values(fields).filter(v => v !== '').length, [fields]);

  async function handleCreate() {
    if (!name.trim()) {
      showToast('Template name is required', true);
      return;
    }
    const desired_json: Record<string, number> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v === '') continue;
      desired_json[k] = Number(v);
    }
    if (Object.keys(desired_json).length === 0) {
      showToast('Set at least one field', true);
      return;
    }
    setCreating(true);
    try {
      await createConfigTemplate({ name: name.trim(), description: description.trim() || undefined, desired_json });
      showToast('Template created');
      setName('');
      setDescription('');
      setFields({});
      load();
    } catch (err: any) {
      showToast(err.message || 'Could not create template', true);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string, templateName: string) {
    if (!window.confirm(`Delete template "${templateName}"? This cannot be undone.`)) return;
    try {
      await deleteConfigTemplate(id);
      showToast('Template deleted');
      load();
    } catch (err: any) {
      showToast(err.message || 'Could not delete template', true);
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%', overflowY: 'auto' }}>
      <Box>
        <Typography variant="h4">Configuration Templates</Typography>
        <Typography variant="caption" color="text.secondary">
          Named, reusable settings sets — applying one merges its keys into a device's existing configuration.
        </Typography>
      </Box>

      <Card elevation={1}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            New Template
          </Typography>
          <Stack spacing={2} sx={{ mb: 2 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 2fr' }, gap: 2 }}>
              <TextField size="small" label="Name" value={name} onChange={e => setName(e.target.value)} />
              <TextField size="small" label="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} />
            </Box>
          </Stack>

          {layerAGroups.map(group => (
            <Box key={group.title} sx={{ mb: 2 }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                {group.title}
              </Typography>
              <Stack spacing={1.5}>
                {group.fields.map(field => {
                  const current = fields[field.key] ?? '';
                  return (
                    <Box key={field.key} sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                      <Box sx={{ minWidth: 200, flex: 1 }}>
                        <Typography variant="body2">{field.label}</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }}>
                          {field.key}
                          {field.kind === 'number' && field.min !== undefined ? ` · ${field.min}–${field.max} ${field.unit || ''}` : ''}
                        </Typography>
                      </Box>
                      {field.kind === 'boolean' ? (
                        <Switch checked={current === '1'} onChange={e => setField(field.key, e.target.checked ? '1' : '')} />
                      ) : (
                        <TextField
                          size="small"
                          type="number"
                          placeholder="not included"
                          value={current}
                          onChange={e => setField(field.key, e.target.value)}
                          slotProps={{ htmlInput: { min: field.min, max: field.max } }}
                          sx={{ width: 140 }}
                        />
                      )}
                    </Box>
                  );
                })}
              </Stack>
            </Box>
          ))}

          <Divider sx={{ mb: 2 }} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Button variant="contained" startIcon={<AddIcon />} onClick={handleCreate} disabled={creating}>
              Create template
            </Button>
            <Typography variant="caption" color="text.secondary">
              {includedCount} field{includedCount === 1 ? '' : 's'} will be included
            </Typography>
          </Box>
        </CardContent>
      </Card>

      <Typography variant="h6">Saved Templates</Typography>
      {loading ? (
        <Box sx={{ display: 'grid', placeItems: 'center', height: 120 }}>
          <CircularProgress />
        </Box>
      ) : templates.length === 0 ? (
        <Typography color="text.secondary">No templates yet — create one above.</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {templates.map(t => (
            <Card key={t.id} elevation={1}>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      {t.name}
                    </Typography>
                    {t.description && (
                      <Typography variant="body2" color="text.secondary">
                        {t.description}
                      </Typography>
                    )}
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                      {Object.entries(t.desired_json).map(([k, v]) => (
                        <Chip key={k} size="small" label={`${k}=${v}`} variant="outlined" sx={{ fontFamily: monoFont }} />
                      ))}
                    </Box>
                  </Box>
                  <Tooltip title="Delete template">
                    <IconButton size="small" color="error" onClick={() => handleDelete(t.id, t.name)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
        To apply a template, select devices on the Devices page and use its "Apply Template" action.
      </Typography>
    </Box>
  );
};
