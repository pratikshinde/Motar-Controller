import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchUserTree } from '../api/users';
import { useViewing } from '../api/viewing';
import { useAuth } from '../context/AuthContext';
import { TeamTree } from '../components/team/TeamTree';
import { NameBlock, RoleChip } from '../components/team/teamStyle';
import type { UserTreeNode } from '../types';

const kids = (n: UserTreeNode) => n.children || [];

function findNode(nodes: UserTreeNode[], id: string): UserTreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const inner = findNode(kids(n), id);
    if (inner) return inner;
  }
  return null;
}

function count(node: UserTreeNode) {
  const c = { distributors: 0, dealers: 0, farmers: 0 };
  const walk = (n: UserTreeNode) => {
    for (const k of kids(n)) {
      if (k.role === 'distributor') c.distributors += 1;
      else if (k.role === 'dealer') c.dealers += 1;
      else if (k.role === 'customer') c.farmers += 1;
      walk(k);
    }
  };
  walk(node);
  return c;
}

/** The hierarchy as a tree: distributors, the dealers under each, the farmers under each dealer. For an admin or a distributor it is their own tree
 *  (`?of=<id>` shows one person's branch); for the platform owner it is one admin's tree, to look at only. */
export const HierarchyView: React.FC = () => {
  const { user } = useAuth();
  const viewing = useViewing();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const of = params.get('of');
  const [tree, setTree] = useState<UserTreeNode[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await fetchUserTree();
      const list = Array.isArray(data) ? data : ((data as any)?.tree || (data as any)?.data || []);
      setTree(Array.isArray(list) ? list : []);
      setError('');
    } catch (err: any) {
      setError(err?.message || 'Could not load the hierarchy');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const root = useMemo(() => (tree ? (of ? findNode(tree, of) : tree[0] ?? null) : null), [tree, of]);
  const totals = useMemo(() => (root ? count(root) : null), [root]);

  const backTo = viewing ? `/manufacturers/${encodeURIComponent(viewing.key)}` : of ? `/people/${of}` : '/dashboard';
  const backLabel = viewing ? 'Back to dashboard' : of ? 'Back' : 'Dashboard';
  const lookOnly = Boolean(viewing);
  const owner = user?.role;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Box>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(backTo)} data-testid="back-to-dashboard">
          {backLabel}
        </Button>
      </Box>

      <Box>
        <Typography variant="h4" sx={{ fontWeight: 800, fontSize: '1.5rem' }}>
          {viewing ? `${viewing.name}: hierarchy` : 'Hierarchy'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {lookOnly
            ? 'Its distributors, the dealers under each, and the farmers under each dealer. You are looking only: nothing here can be changed.'
            : owner === 'distributor' || of
              ? 'The dealers, and the farmers under each dealer. Click a name for their dashboard.'
              : 'Your distributors, the dealers under each, and the farmers under each dealer. Click a name for their dashboard.'}
        </Typography>
      </Box>

      {error && !tree && <Alert severity="error">{error}</Alert>}
      {!tree && !error && (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}
      {tree && !root && <Typography color="text.secondary">Nothing to show here.</Typography>}

      {root && totals && (
        <>
          <Paper variant="outlined" sx={{ borderRadius: 3, p: 1.75, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }} data-testid="team-root">
            <Box sx={{ flex: '1 1 240px', minWidth: 0 }}>
              <NameBlock node={root} size={48} />
            </Box>
            <RoleChip role={root.role} />
            <Stack direction="row" spacing={2} data-testid="hierarchy-counts">
              {totals.distributors > 0 && <Typography variant="body2">{totals.distributors} distributors</Typography>}
              {root.role !== 'dealer' && <Typography variant="body2">{totals.dealers} dealers</Typography>}
              <Typography variant="body2">{totals.farmers} farmers</Typography>
            </Stack>
          </Paper>

          <TeamTree root={root} onOpen={lookOnly ? undefined : n => navigate(`/people/${n.id}`)} />
        </>
      )}
    </Box>
  );
};
