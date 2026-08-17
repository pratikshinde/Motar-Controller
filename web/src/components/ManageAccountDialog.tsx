import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Stack, FormControlLabel, Switch, Divider, Typography, Box
} from '@mui/material';
import { updateUserAccount, deleteUserAccount, ROLE_NAMES } from '../api/users';
import { fetchUserBranding, setUserBranding } from '../api/branding';
import { isValidHexColor } from '../theme/dynamicPalette';
import { useToast } from '../context/ToastContext';
import type { UserTreeNode } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  target: UserTreeNode | null;
}

// FR-WEB-012 — Superadmin-only: edit contract details/quota, suspend or
// reactivate, or delete an account. Generic on any account, not just
// panel-manufacturer role — the mechanism doesn't need to be narrower
// than the schema it's built on.
export const ManageAccountDialog: React.FC<Props> = ({ open, onClose, onChanged, target }) => {
  const { showToast } = useToast();
  const [fullName, setFullName] = useState('');
  const [contractNotes, setContractNotes] = useState('');
  const [deviceQuota, setDeviceQuota] = useState('');
  const [suspended, setSuspended] = useState(false);
  const [busy, setBusy] = useState(false);

  // FR-WEB-036 — branding only applies to manufacturer-tier accounts
  // (§8.1: it attaches to the partner's own node, not any subordinate).
  const isManufacturer = target?.role === 'manufacturer';
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('');
  const [senderName, setSenderName] = useState('');
  const [subdomain, setSubdomain] = useState('');

  useEffect(() => {
    if (open && target) {
      setFullName(target.full_name);
      setContractNotes(target.contract_notes || '');
      setDeviceQuota(target.device_quota != null ? String(target.device_quota) : '');
      setSuspended(target.account_status === 'SUSPENDED');
      setLogoUrl('');
      setPrimaryColor('');
      setSenderName('');
      setSubdomain('');
      if (target.role === 'manufacturer') {
        fetchUserBranding(target.id).then(({ branding }) => {
          if (!branding) return;
          setLogoUrl(branding.logo_url || '');
          setPrimaryColor(branding.primary_color || '');
          setSenderName(branding.notification_sender_name || '');
          setSubdomain(branding.subdomain || '');
        });
      }
    }
  }, [open, target]);

  async function handleSave() {
    if (!target) return;
    if (isManufacturer && primaryColor && !isValidHexColor(primaryColor)) {
      showToast('Primary color must be a 6-digit hex value like #0B5FA5', true);
      return;
    }
    setBusy(true);
    try {
      await updateUserAccount(target.id, {
        full_name: fullName.trim() || undefined,
        contract_notes: contractNotes.trim(),
        device_quota: deviceQuota.trim() ? Number(deviceQuota) : undefined,
        account_status: suspended ? 'SUSPENDED' : 'ACTIVE'
      });
      if (isManufacturer && primaryColor) {
        await setUserBranding(target.id, {
          logo_url: logoUrl.trim() || undefined,
          primary_color: primaryColor.trim(),
          notification_sender_name: senderName.trim() || undefined,
          subdomain: subdomain.trim() || undefined
        });
      }
      showToast('Account updated');
      onChanged();
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Could not update account', true);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!target) return;
    if (!window.confirm(`Delete ${target.full_name}'s account permanently? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deleteUserAccount(target.id);
      showToast(`${target.full_name} deleted`);
      onChanged();
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Could not delete account', true);
    } finally {
      setBusy(false);
    }
  }

  if (!target) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Manage Account</DialogTitle>
      <DialogContent>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          {ROLE_NAMES[target.role]} · {target.phone_number}
        </Typography>
        <Stack spacing={2}>
          <TextField label="Full name" value={fullName} onChange={e => setFullName(e.target.value)} fullWidth />
          <TextField
            label="Contract notes"
            value={contractNotes}
            onChange={e => setContractNotes(e.target.value)}
            multiline
            minRows={2}
            fullWidth
          />
          <TextField
            label="Device quota"
            type="number"
            value={deviceQuota}
            onChange={e => setDeviceQuota(e.target.value)}
            fullWidth
            helperText="Leave blank for no limit"
          />
          <FormControlLabel
            control={<Switch checked={suspended} onChange={e => setSuspended(e.target.checked)} color="warning" />}
            label={suspended ? 'Account suspended — login blocked' : 'Account active'}
          />
        </Stack>

        {isManufacturer && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="overline" color="text.secondary">
              Branding (FR-WEB-036)
            </Typography>
            <Stack spacing={2} sx={{ mt: 0.5 }}>
              <TextField label="Logo URL" value={logoUrl} onChange={e => setLogoUrl(e.target.value)} fullWidth />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <TextField
                  label="Primary color"
                  placeholder="#0B5FA5"
                  value={primaryColor}
                  onChange={e => setPrimaryColor(e.target.value)}
                  error={Boolean(primaryColor) && !isValidHexColor(primaryColor)}
                  fullWidth
                />
                {isValidHexColor(primaryColor) && (
                  <Box sx={{ width: 32, height: 32, borderRadius: 1, flexShrink: 0, bgcolor: primaryColor, border: '1px solid rgba(0,0,0,0.2)' }} />
                )}
              </Box>
              <TextField
                label="Notification sender name"
                value={senderName}
                onChange={e => setSenderName(e.target.value)}
                helperText="Stored for later — not yet applied to SMS/WhatsApp dispatch (coupled to the notification service, not the portal)"
                fullWidth
              />
              <TextField label="Subdomain (optional)" value={subdomain} onChange={e => setSubdomain(e.target.value)} fullWidth />
            </Stack>
          </>
        )}

        <Divider sx={{ my: 2 }} />
        <Button color="error" size="small" onClick={handleDelete} disabled={busy}>
          Delete account
        </Button>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={busy}>
          Save changes
        </Button>
      </DialogActions>
    </Dialog>
  );
};
