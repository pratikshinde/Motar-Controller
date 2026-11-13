import React from 'react';
import { Avatar, Box, Chip, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import WarehouseIcon from '@mui/icons-material/Warehouse';
import StorefrontIcon from '@mui/icons-material/Storefront';
import AgricultureIcon from '@mui/icons-material/Agriculture';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import type { SvgIconComponent } from '@mui/icons-material';
import type { RoleTier, UserTreeNode } from '../../types';

export interface RoleLook {
  label: string;
  plural: string;
  Icon: SvgIconComponent;
  color: string;
}

/** One colour per level, so a row says who it is at a glance: the admin gold, the distributor business blue, the dealer purple, the farmer green
 *  (the colour of the fields). Each has a lighter shade for the dark theme and a deeper one for the light theme. */
const LEVEL_COLORS = {
  distributor: { dark: '#7C9CFF', light: '#3F5FD8' },
  dealer: { dark: '#C58BF2', light: '#8E44C7' }
};

/** How each level of the hierarchy looks: one colour and one icon per level, the same on every tab. */
export function useRoleLook(role: RoleTier): RoleLook {
  const { palette } = useTheme();
  const shade = palette.mode === 'dark' ? 'dark' : 'light';
  switch (role) {
    case 'distributor':
      return { label: 'Distributor', plural: 'Distributors', Icon: WarehouseIcon, color: LEVEL_COLORS.distributor[shade] };
    case 'dealer':
      return { label: 'Dealer', plural: 'Dealers', Icon: StorefrontIcon, color: LEVEL_COLORS.dealer[shade] };
    case 'customer':
      return { label: 'Farmer', plural: 'Farmers', Icon: AgricultureIcon, color: palette.success.main };
    default:
      return { label: role === 'superadmin' ? 'Platform owner' : 'Admin', plural: 'Admins', Icon: AdminPanelSettingsIcon, color: palette.warning.main };
  }
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]!.toUpperCase())
    .join('') || '?';

/** The round badge with a person's initials, tinted by their level. */
export const PersonAvatar: React.FC<{ node: UserTreeNode; size?: number }> = ({ node, size = 40 }) => {
  const look = useRoleLook(node.role);
  return (
    <Avatar
      sx={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        fontWeight: 700,
        color: look.color,
        bgcolor: alpha(look.color, 0.16),
        border: `1px solid ${alpha(look.color, 0.35)}`
      }}
    >
      {initials(node.full_name)}
    </Avatar>
  );
};

/** The level as a small coloured pill with its icon. */
export const RoleChip: React.FC<{ role: RoleTier }> = ({ role }) => {
  const look = useRoleLook(role);
  return (
    <Chip
      size="small"
      icon={<look.Icon sx={{ fontSize: 15, color: `${look.color} !important` }} />}
      label={look.label}
      sx={{ color: look.color, bgcolor: alpha(look.color, 0.12), fontWeight: 600, height: 22, '& .MuiChip-label': { px: 0.75 } }}
    />
  );
};

/** "Not signed in yet" / "Suspended", or nothing when the account is in good order. */
export const StatusChips: React.FC<{ node: UserTreeNode }> = ({ node }) => (
  <>
    {node.account_status === 'SUSPENDED' && <Chip size="small" label="Suspended" color="warning" variant="outlined" sx={{ height: 22 }} />}
    {(node.role === 'distributor' || node.role === 'dealer') && node.has_signed_in === false && (
      <Chip size="small" label="Not signed in yet" variant="outlined" sx={{ height: 22 }} data-testid={`unclaimed-${node.id}`} />
    )}
  </>
);

/** A name over a mobile number, the same on every row. */
export const NameBlock: React.FC<{ node: UserTreeNode; size?: number }> = ({ node, size = 40 }) => (
  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
    <PersonAvatar node={node} size={size} />
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontWeight: 600, lineHeight: 1.25 }} noWrap>
        {node.full_name}
      </Typography>
      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
        {node.phone_number || node.email || 'No contact details'}
      </Typography>
    </Box>
  </Stack>
);
