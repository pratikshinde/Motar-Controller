import React, { useState } from 'react';
import { Box, Button, Collapse, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PersonAddIcon from '@mui/icons-material/PersonAddAlt';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import type { UserTreeNode } from '../../types';
import { NameBlock, RoleChip, StatusChips, useRoleLook } from './teamStyle';

export interface TreeActions {
  /** Open "add" under this account (a distributor adds dealers under itself). Absent when nobody may add here. */
  onAddUnder?: (node: UserTreeNode, role: 'dealer') => void;
  /** Make a new QR for this distributor or dealer. Absent when nobody may. */
  onNewQr?: (node: UserTreeNode) => void;
}

const kids = (n: UserTreeNode) => n.children || [];

function counts(node: UserTreeNode): { dealers: number; farmers: number } {
  let dealers = 0;
  let farmers = 0;
  for (const c of kids(node)) {
    if (c.role === 'dealer') dealers += 1;
    if (c.role === 'customer') farmers += 1;
    const s = counts(c);
    dealers += s.dealers;
    farmers += s.farmers;
  }
  return { dealers, farmers };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const Branch: React.FC<{ node: UserTreeNode; depth: number; actions: TreeActions; defaultOpen: boolean; onOpen?: (node: UserTreeNode) => void }> = ({ node, depth, actions, defaultOpen, onOpen }) => {
  const { palette } = useTheme();
  const look = useRoleLook(node.role);
  const children = kids(node);
  const [open, setOpen] = useState(defaultOpen);
  const sub = counts(node);
  const isPartner = node.role === 'distributor' || node.role === 'dealer';
  const summary = [
    node.role === 'distributor' && sub.dealers > 0 ? plural(sub.dealers, 'dealer') : '',
    (node.role === 'distributor' || node.role === 'dealer') && sub.farmers > 0 ? plural(sub.farmers, 'farmer') : ''
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Box data-testid={`branch-${node.id}`}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          flexWrap: 'wrap',
          px: 1.5,
          py: node.role === 'customer' ? 0.9 : 1.25,
          borderRadius: 2.5,
          border: `1px solid ${node.role === 'customer' ? palette.divider : alpha(look.color, 0.3)}`,
          bgcolor: node.role === 'customer' ? 'transparent' : alpha(look.color, 0.05),
          opacity: node.account_status === 'SUSPENDED' ? 0.6 : 1
        }}
      >
        {children.length > 0 ? (
          <IconButton size="small" onClick={() => setOpen(o => !o)} aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open}>
            <ExpandMoreIcon sx={{ transition: 'transform .2s', transform: open ? 'none' : 'rotate(-90deg)' }} />
          </IconButton>
        ) : (
          <Box sx={{ width: 34 }} />
        )}
        <Box
          sx={{ flex: '1 1 220px', minWidth: 0, cursor: onOpen ? 'pointer' : 'default', '&:hover': onOpen ? { opacity: 0.8 } : undefined }}
          onClick={onOpen ? () => onOpen(node) : undefined}
          data-testid={onOpen ? `open-${node.id}` : undefined}
        >
          <NameBlock node={node} size={node.role === 'customer' ? 32 : 40} />
        </Box>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
          <RoleChip role={node.role} />
          <StatusChips node={node} />
        </Stack>
        {summary && (
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            {summary}
          </Typography>
        )}
        <Stack direction="row" spacing={0.5} sx={{ ml: 'auto' }}>
          {node.role === 'distributor' && actions.onAddUnder && (
            <Button size="small" startIcon={<PersonAddIcon fontSize="small" />} onClick={() => actions.onAddUnder?.(node, 'dealer')}>
              Add dealer
            </Button>
          )}
          {isPartner && actions.onNewQr && (
            <Tooltip title={node.has_signed_in ? 'They lost their password: make a new QR to set a new one' : 'They have not opened their account yet: make a new QR'}>
              <Button size="small" startIcon={<QrCode2Icon fontSize="small" />} onClick={() => actions.onNewQr?.(node)} data-testid={`new-qr-${node.id}`}>
                New QR
              </Button>
            </Tooltip>
          )}
        </Stack>
      </Box>

      {children.length > 0 && (
        <Collapse in={open} unmountOnExit>
          <Box
            sx={{
              ml: { xs: 2, sm: 4.25 },
              pl: { xs: 1.5, sm: 2.5 },
              mt: 1,
              borderLeft: `2px solid ${alpha(look.color, 0.35)}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 1
            }}
          >
            {children.map(child => (
              <Branch key={child.id} node={child} depth={depth + 1} actions={actions} defaultOpen={depth < 1} onOpen={onOpen} />
            ))}
          </Box>
        </Collapse>
      )}
    </Box>
  );
};

/** The whole tree: you at the top, then distributors, the dealers under each, and the farmers under each dealer. Anyone may also sit directly
 *  under you (an admin's own dealers and farmers), shown in the same list. Click the arrow to fold a branch. */
export const TeamTree: React.FC<{ root: UserTreeNode; actions?: TreeActions; onOpen?: (node: UserTreeNode) => void }> = ({ root, actions = {}, onOpen }) => {
  const children = kids(root);
  // Distributors first, then dealers, then farmers, so the structure reads top-down.
  const order = { distributor: 0, dealer: 1, customer: 2 } as Record<string, number>;
  const sorted = [...children].sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9) || a.full_name.localeCompare(b.full_name));
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }} data-testid="team-tree">
      {sorted.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 3 }}>
          Nobody is under you yet. Add a distributor or a dealer to start.
        </Typography>
      ) : (
        sorted.map(child => <Branch key={child.id} node={child} depth={0} actions={actions} defaultOpen onOpen={onOpen} />)
      )}
    </Box>
  );
};
