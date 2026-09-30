import React from 'react';
import { Box, Typography, Button, Card, Chip, IconButton, Tooltip } from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAddAlt';
import GroupAddIcon from '@mui/icons-material/GroupAdd';
import SettingsIcon from '@mui/icons-material/Settings';
import LinkIcon from '@mui/icons-material/Link';
import { ROLE_NAMES } from '../api/users';
import { useAuth } from '../context/AuthContext';
import { monoFont } from '../theme';
import type { UserTreeNode as UserTreeNodeType, RoleTier } from '../types';

const CAN_ADD_UNDER: RoleTier[] = ['superadmin', 'manufacturer', 'distributor', 'dealer'];

interface Props {
  node: UserTreeNodeType;
  depth: number;
  onAddUnder: (role: RoleTier, parentId: string, parentPath: string) => void;
  onAddStaff: (orgNodeId: string) => void;
  onInvite: (role: RoleTier, parentId: string, parentPath: string) => void;
  onManage: (target: UserTreeNodeType) => void;
}

export const UserTreeNodeView: React.FC<Props> = ({ node, depth, onAddUnder, onAddStaff, onInvite, onManage }) => {
  const { user } = useAuth();
  const roleLabel = ROLE_NAMES[node.role] || node.role;
  const depthTag = node.role === 'dealer' && node.dealer_depth !== undefined ? ` (dealer depth ${node.dealer_depth})` : '';
  const canAdd = CAN_ADD_UNDER.includes(node.role);
  const isSuperadmin = user?.role === 'superadmin';
  const canAddStaff = node.role !== 'customer' && (isSuperadmin || user?.id === node.id);
  const suspended = node.account_status === 'SUSPENDED';

  const members = node.members || [];
  const children = node.children || [];

  return (
    <Box sx={{ ml: depth * 3 }}>
      <Card
        elevation={0}
        sx={{
          display: 'flex',
          // Below md the name/role text and the row of up to 3 action buttons no longer both fit on one
          // line — forcing them to share it (as a single non-wrapping flex row) squeezed the text down to
          // a sliver of the card and wrapped it across several cramped lines. This has to stack well
          // before the app's own compact/rail nav breakpoint (down('sm')): the rail already claims part
          // of the width the row needs, so a plain `sm` switch was still too narrow — verified live.
          flexDirection: { xs: 'column', md: 'row' },
          alignItems: { xs: 'stretch', md: 'center' },
          justifyContent: 'space-between',
          gap: { xs: 1, md: 0 },
          px: 2,
          py: 1,
          mb: 1,
          bgcolor: 'background.surfaceVariant',
          border: 'none',
          opacity: suspended ? 0.6 : 1
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="body2" component="span" sx={{ fontWeight: 700 }}>
              {node.full_name}
            </Typography>
            <Typography variant="body2" component="span" color="text.secondary">
              — {roleLabel}
              {depthTag}
            </Typography>
            {suspended && <Chip size="small" label="Suspended" color="warning" variant="outlined" />}
            {members.length > 1 && <Chip size="small" label={`${members.length} logins`} variant="outlined" />}
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontFamily: monoFont }}>
            {node.phone_number || ''}
          </Typography>
          {members.length > 1 && (
            <Box sx={{ mt: 0.5, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
              {members
                .filter(m => m.id !== node.id)
                .map(m => (
                  <Typography key={m.id} variant="caption" color="text.secondary" sx={{ fontFamily: monoFont }}>
                    ↳ {m.full_name} ({m.org_role || 'staff'}) — {m.phone_number}
                    {m.account_status === 'SUSPENDED' ? ' · suspended' : ''}
                  </Typography>
                ))}
            </Box>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0, flexWrap: 'wrap' }}>
          {canAddStaff && (
            <Tooltip title="Add staff login to this account">
              <Button size="small" variant="tonal" startIcon={<GroupAddIcon fontSize="small" />} onClick={() => onAddStaff(node.id)}>
                Add Staff
              </Button>
            </Tooltip>
          )}
          {canAdd && (
            <Button
              size="small"
              variant="tonal"
              startIcon={<PersonAddIcon fontSize="small" />}
              onClick={() => onAddUnder(node.role, node.id, node.hierarchy_path)}
            >
              Add Subordinate
            </Button>
          )}
          {canAdd && (
            <Tooltip title="Generate a self-registration link for a new subordinate account">
              <Button
                size="small"
                variant="tonal"
                startIcon={<LinkIcon fontSize="small" />}
                onClick={() => onInvite(node.role, node.id, node.hierarchy_path)}
              >
                Invite Link
              </Button>
            </Tooltip>
          )}
          {isSuperadmin && (
            <Tooltip title="Manage account">
              <IconButton size="small" onClick={() => onManage(node)}>
                <SettingsIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Card>
      {children.map(child => (
        <UserTreeNodeView
          key={child.id}
          node={child}
          depth={depth + 1}
          onAddUnder={onAddUnder}
          onAddStaff={onAddStaff}
          onInvite={onInvite}
          onManage={onManage}
        />
      ))}
    </Box>
  );
};
