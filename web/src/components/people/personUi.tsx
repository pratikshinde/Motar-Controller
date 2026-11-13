import React from 'react';
import { Avatar, Box, Button, Card, CardActionArea, Chip, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import type { TeamMember } from '../../api/team';
import { lineageOf } from '../../api/team';
import { initials, RoleChip, useRoleLook } from '../team/teamStyle';
import { formatDate } from '../platform/platformUi';

/** The round badge with a person's initials, tinted by their level (distributor blue, dealer purple, farmer green). */
export const MemberAvatar: React.FC<{ m: Pick<TeamMember, 'role' | 'full_name'>; size?: number }> = ({ m, size = 48 }) => {
  const look = useRoleLook(m.role);
  return (
    <Avatar sx={{ width: size, height: size, fontSize: size * 0.38, fontWeight: 800, color: look.color, bgcolor: alpha(look.color, 0.16), border: `1px solid ${alpha(look.color, 0.4)}` }}>
      {initials(m.full_name)}
    </Avatar>
  );
};

/** "Not signed in yet" / "Stopped", or nothing when the account is in good order. */
export const MemberChips: React.FC<{ m: TeamMember }> = ({ m }) => (
  <>
    {m.account_status === 'SUSPENDED' && <Chip size="small" label={m.role === 'customer' ? 'Stopped' : 'Suspended'} color="warning" variant="outlined" sx={{ height: 22 }} />}
    {m.has_signed_in === false && <Chip size="small" label="Not signed in yet" variant="outlined" sx={{ height: 22 }} data-testid={`unclaimed-${m.id}`} />}
  </>
);

const Mini: React.FC<{ label: string; value: number; color?: string }> = ({ label, value, color }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '1.3rem', fontWeight: 800, lineHeight: 1.1, color }}>{value}</Typography>
    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
      {label}
    </Typography>
  </Box>
);

/** The three or four numbers worth a glance for this level. */
export function memberStats(m: TeamMember, success: string): { label: string; value: number; color?: string }[] {
  if (m.role === 'distributor') {
    return [
      { label: 'Dealers', value: m.dealers },
      { label: 'Farmers', value: m.farmers },
      { label: 'Pumps', value: m.pumps.total },
      { label: 'Running', value: m.pumps.running, color: success }
    ];
  }
  if (m.role === 'dealer') {
    return [
      { label: 'Farmers', value: m.farmers },
      { label: 'Pumps', value: m.pumps.total },
      { label: 'Running', value: m.pumps.running, color: success }
    ];
  }
  return [
    { label: 'Pumps', value: m.pumps.total },
    { label: 'Running', value: m.pumps.running, color: success }
  ];
}

/** A distributor, dealer or farmer as a card: who they are, where they sit and their numbers. Click for their own dashboard. */
export const PersonCard: React.FC<{ m: TeamMember; onOpen: () => void; onNewQr?: () => void }> = ({ m, onOpen, onNewQr }) => {
  const theme = useTheme();
  const look = useRoleLook(m.role);
  const stats = memberStats(m, theme.palette.success.main);
  return (
    <Card
      variant="outlined"
      data-testid={`person-${m.id}`}
      sx={{ borderRadius: 3.5, overflow: 'hidden', borderColor: alpha(look.color, 0.35), opacity: m.account_status === 'SUSPENDED' ? 0.65 : 1, display: 'flex', flexDirection: 'column' }}
    >
      <Box sx={{ height: 5, bgcolor: look.color }} />
      <CardActionArea onClick={onOpen} sx={{ p: 2.25, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 2 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <MemberAvatar m={m} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 800, lineHeight: 1.2 }} noWrap>
              {m.full_name}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {m.phone_number || m.email || 'No contact details'}
            </Typography>
          </Box>
          <RoleChip role={m.role} />
        </Stack>

        {(m.above.length > 0 || m.role !== 'distributor') && (
          <Typography variant="caption" color="text.secondary" noWrap>
            Under: {lineageOf(m)}
          </Typography>
        )}

        <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${stats.length}, 1fr)`, gap: 1.5 }}>
          {stats.map(s => (
            <Mini key={s.label} {...s} />
          ))}
        </Box>

        <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', rowGap: 0.5, minHeight: 22 }}>
          <MemberChips m={m} />
        </Stack>
      </CardActionArea>
      <Stack direction="row" sx={{ px: 2.25, py: 0.75, alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${theme.palette.divider}` }}>
        <Typography variant="caption" color="text.secondary">
          {m.created_at ? `Added ${formatDate(m.created_at)}` : ''}
        </Typography>
        {onNewQr && m.role !== 'customer' && (
          <Button size="small" startIcon={<QrCode2Icon fontSize="small" />} onClick={onNewQr} data-testid={`new-qr-${m.id}`}>
            New QR
          </Button>
        )}
      </Stack>
    </Card>
  );
};
