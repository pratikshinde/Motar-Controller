import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, FormControl,
  InputLabel, Select, MenuItem, Typography, Box, Chip, TextField, Stack, Divider
} from '@mui/material';
import { useLocale } from '../context/LocaleContext';
import { useAuth } from '../context/AuthContext';
import { useBranding } from '../context/BrandingContext';
import { useToast } from '../context/ToastContext';
import { disableMfa } from '../api/mfa';
import { updateStoredUser } from '../api/client';
import { fetchMyBranding, setMyBranding } from '../api/branding';
import { isValidHexColor } from '../theme/dynamicPalette';
import { supportedLocales, localeLabels } from '../i18n';

export const SettingsDialog: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { locale, setLocale, t } = useLocale();
  const { user, setUser } = useAuth();
  const { refresh: refreshBranding } = useBranding();
  const { showToast } = useToast();

  const [disabling, setDisabling] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const isManufacturer = user?.role === 'manufacturer';
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('');
  const [senderName, setSenderName] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [brandBusy, setBrandBusy] = useState(false);

  useEffect(() => {
    if (open && isManufacturer) {
      fetchMyBranding().then(({ branding }) => {
        setLogoUrl(branding?.logo_url || '');
        setPrimaryColor(branding?.primary_color || '');
        setSenderName(branding?.notification_sender_name || '');
        setSubdomain(branding?.subdomain || '');
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isManufacturer]);

  async function handleSaveBranding() {
    if (!primaryColor || !isValidHexColor(primaryColor)) {
      showToast('Primary color must be a 6-digit hex value like #0B5FA5', true);
      return;
    }
    setBrandBusy(true);
    try {
      await setMyBranding({
        logo_url: logoUrl.trim() || undefined,
        primary_color: primaryColor.trim(),
        notification_sender_name: senderName.trim() || undefined,
        subdomain: subdomain.trim() || undefined
      });
      showToast('Branding updated');
      refreshBranding();
    } catch (err: any) {
      showToast(err.message || 'Could not save branding', true);
    } finally {
      setBrandBusy(false);
    }
  }

  async function handleDisable() {
    if (!user) return;
    setBusy(true);
    try {
      await disableMfa(code.trim());
      const patched = { ...user, totp_enabled: false };
      setUser(patched);
      updateStoredUser({ totp_enabled: false });
      showToast('MFA disabled');
      setDisabling(false);
      setCode('');
    } catch (err: any) {
      showToast(err.message || 'Incorrect code', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t.settingsTitle}</DialogTitle>
      <DialogContent>
        <FormControl fullWidth sx={{ mt: 1, mb: 3 }}>
          <InputLabel id="lang-select-label">Interface Language</InputLabel>
          <Select
            labelId="lang-select-label"
            label="Interface Language"
            value={locale}
            onChange={e => setLocale(e.target.value as typeof locale)}
          >
            {supportedLocales.map(code => (
              <MenuItem key={code} value={code}>
                {localeLabels[code]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Typography variant="overline" color="text.secondary">
          Security
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 0.5, mb: disabling ? 1.5 : 0 }}>
          <Typography variant="body2">Two-factor authentication</Typography>
          <Chip
            size="small"
            label={user?.totp_enabled ? 'Enabled' : 'Not enabled'}
            color={user?.totp_enabled ? 'success' : 'default'}
            variant={user?.totp_enabled ? 'filled' : 'outlined'}
          />
        </Box>

        {user?.totp_enabled && !disabling && (
          <Button size="small" color="error" onClick={() => setDisabling(true)}>
            Disable MFA
          </Button>
        )}

        {user?.totp_enabled && disabling && (
          <Stack spacing={1.5}>
            <TextField
              size="small"
              label="Current code, to confirm"
              placeholder="123456"
              value={code}
              onChange={e => setCode(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 6 } }}
            />
            <Stack direction="row" spacing={1}>
              <Button size="small" onClick={() => setDisabling(false)}>
                Cancel
              </Button>
              <Button size="small" color="error" variant="contained" disabled={busy || code.trim().length !== 6} onClick={handleDisable}>
                Confirm disable
              </Button>
            </Stack>
          </Stack>
        )}

        {isManufacturer && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="overline" color="text.secondary">
              Branding (FR-WEB-036)
            </Typography>
            <Stack spacing={2} sx={{ mt: 0.5 }}>
              <TextField size="small" label="Logo URL" value={logoUrl} onChange={e => setLogoUrl(e.target.value)} fullWidth />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <TextField
                  size="small"
                  label="Primary color"
                  placeholder="#0B5FA5"
                  value={primaryColor}
                  onChange={e => setPrimaryColor(e.target.value)}
                  error={Boolean(primaryColor) && !isValidHexColor(primaryColor)}
                  fullWidth
                />
                {isValidHexColor(primaryColor) && (
                  <Box sx={{ width: 28, height: 28, borderRadius: 1, flexShrink: 0, bgcolor: primaryColor, border: '1px solid rgba(0,0,0,0.2)' }} />
                )}
              </Box>
              <TextField
                size="small"
                label="Notification sender name"
                value={senderName}
                onChange={e => setSenderName(e.target.value)}
                helperText="Stored for later — not yet applied to SMS/WhatsApp dispatch"
                fullWidth
              />
              <TextField size="small" label="Subdomain (optional)" value={subdomain} onChange={e => setSubdomain(e.target.value)} fullWidth />
              <Button size="small" variant="tonal" onClick={handleSaveBranding} disabled={brandBusy} sx={{ alignSelf: 'flex-start' }}>
                Save branding
              </Button>
            </Stack>
          </>
        )}

        <Divider sx={{ my: 2 }} />

        <Typography variant="overline" color="text.secondary">
          Telemetry ingestion rules
        </Typography>
        <Box sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'text.secondary', lineHeight: 1.8 }}>
          Pump OFF: every 5 minutes (300s)
          <br />
          Pump ON: every 2 minutes (120s)
          <br />
          Fault / event: instant (&lt;100ms)
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};
