import React from 'react';
import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { timeAgo } from '../../utils/timeAgo';
import type { Registration, RegistrationStatus } from '../../api/registrations';

const LABEL: Record<RegistrationStatus, { text: string; color: 'info' | 'success' | 'warning' | 'error' | 'default' }> = {
  WAITING: { text: 'Waiting for the QR to be scanned', color: 'info' },
  SCANNED: { text: 'Scanned: they are choosing a password', color: 'success' },
  EXPIRED: { text: 'QR expired', color: 'warning' },
  BLOCKED: { text: 'Blocked: too many wrong tries', color: 'error' },
  COMPLETED: { text: 'Registered', color: 'success' },
  CANCELLED: { text: 'Cancelled', color: 'default' }
};

/** Registrations that were started and not finished: nobody is an account until they finish, so they are listed here, apart from the people. */
export const PendingRegistrations: React.FC<{ items: Registration[]; onContinue: (r: Registration) => void; onCancel: (r: Registration) => void }> = ({ items, onContinue, onCancel }) => {
  if (items.length === 0) return null;
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, borderStyle: 'dashed' }} data-testid="pending-registrations">
      <Typography sx={{ fontWeight: 700, mb: 1.25 }}>Waiting to finish ({items.length})</Typography>
      <Stack spacing={1}>
        {items.map(r => {
          const l = LABEL[r.status];
          return (
            <Box
              key={r.id}
              data-testid={`pending-${r.id}`}
              sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', p: 1.25, borderRadius: 2, bgcolor: theme => alpha(theme.palette.info.main, 0.05) }}
            >
              <Box sx={{ flex: '1 1 200px', minWidth: 0 }}>
                <Typography sx={{ fontWeight: 600 }} noWrap>
                  {r.full_name} <Typography component="span" variant="body2" color="text.secondary">· {r.phone_number}</Typography>
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Started {timeAgo(r.created_at)}
                </Typography>
              </Box>
              <Chip size="small" color={l.color} variant="outlined" label={l.text} />
              <Button size="small" onClick={() => onContinue(r)} data-testid={`continue-${r.id}`}>
                Continue
              </Button>
              <Button size="small" color="inherit" onClick={() => onCancel(r)} data-testid={`cancel-${r.id}`}>
                Cancel
              </Button>
            </Box>
          );
        })}
      </Stack>
    </Paper>
  );
};
