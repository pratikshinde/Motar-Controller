import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box,
  FormControl, InputLabel, Select, MenuItem, List, ListItem, ListItemText, Chip, Divider
} from '@mui/material';
import { fetchConfigTemplates, applyConfigTemplate } from '../api/configTemplates';
import { useToast } from '../context/ToastContext';
import { monoFont } from '../theme';
import type { ConfigTemplate, ConfigTemplateApplyResult } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
  pumpIds: string[];
}

// FR-WEB-032 — applies a saved config template's keys to every selected
// device, merged into each device's existing desired_json (never a
// wholesale replace — see the backend comment on POST
// /api/config-templates/:id/apply).
export const ApplyTemplateDialog: React.FC<Props> = ({ open, onClose, onApplied, pumpIds }) => {
  const { showToast } = useToast();
  const [templates, setTemplates] = useState<ConfigTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConfigTemplateApplyResult | null>(null);
  const [openedWithCount, setOpenedWithCount] = useState(0);

  useEffect(() => {
    if (open) {
      setTemplateId('');
      setResult(null);
      setOpenedWithCount(pumpIds.length);
      fetchConfigTemplates()
        .then(data => setTemplates(data.templates))
        .catch(err => showToast(err.message || 'Could not load templates', true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedTemplate = templates.find(t => t.id === templateId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!templateId) {
      showToast('Choose a template', true);
      return;
    }
    setBusy(true);
    try {
      const res = await applyConfigTemplate(templateId, pumpIds);
      setResult(res);
      const successCount = res.results.filter(r => r.success).length;
      if (successCount > 0) {
        showToast(res.message);
        onApplied();
      }
    } catch (err: any) {
      showToast(err.message || 'Apply failed', true);
    } finally {
      setBusy(false);
    }
  }

  function handleClose() {
    if (result && result.results.some(r => r.success)) onApplied();
    onClose();
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <form onSubmit={submit}>
        <DialogTitle>Apply Template to {openedWithCount} Device{openedWithCount === 1 ? '' : 's'}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Merges the template's settings into each device's existing configuration — keys not in the template are
            left untouched.
          </Typography>
          <FormControl fullWidth required>
            <InputLabel id="apply-template-label">Template</InputLabel>
            <Select labelId="apply-template-label" label="Template" value={templateId} onChange={e => setTemplateId(e.target.value)}>
              {templates.map(t => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {selectedTemplate && (
            <Box sx={{ mt: 1.5, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {Object.entries(selectedTemplate.desired_json).map(([k, v]) => (
                <Chip key={k} size="small" label={`${k}=${v}`} variant="outlined" sx={{ fontFamily: monoFont }} />
              ))}
            </Box>
          )}

          {result && (
            <Box sx={{ mt: 2 }}>
              <Divider sx={{ mb: 2 }} />
              <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                <Chip size="small" color="success" label={`${result.results.filter(r => r.success).length} applied`} />
                {result.results.some(r => !r.success) && (
                  <Chip size="small" color="error" label={`${result.results.filter(r => !r.success).length} failed`} />
                )}
              </Box>
              {result.results.some(r => !r.success) && (
                <List dense sx={{ maxHeight: 160, overflowY: 'auto', bgcolor: 'background.surfaceVariant', borderRadius: 1 }}>
                  {result.results
                    .filter(r => !r.success)
                    .map(r => (
                      <ListItem key={r.pump_id}>
                        <ListItemText
                          primary={r.pump_id}
                          secondary={r.reason}
                          slotProps={{ primary: { sx: { fontFamily: monoFont, fontSize: '0.85rem' } } }}
                        />
                      </ListItem>
                    ))}
                </List>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Close</Button>
          <Button type="submit" variant="contained" disabled={busy || !templateId}>
            Apply
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};
