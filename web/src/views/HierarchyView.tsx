import React, { useState, useEffect, useCallback } from 'react';
import { Box, Typography, Button, CircularProgress } from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAddAlt';
import { fetchUserTree } from '../api/users';
import { UserTreeNodeView } from '../components/UserTreeNode';
import { AddSubordinateDialog } from '../components/AddSubordinateDialog';
import { AddStaffDialog } from '../components/AddStaffDialog';
import { InviteDialog } from '../components/InviteDialog';
import { ManageAccountDialog } from '../components/ManageAccountDialog';
import type { UserTreeNode, RoleTier } from '../types';

export const HierarchyView: React.FC = () => {
  const [tree, setTree] = useState<UserTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [subDialogOpen, setSubDialogOpen] = useState(false);
  const [subDialogCtx, setSubDialogCtx] = useState<{ role: RoleTier | null; parentId: string | null; parentPath: string | null }>({
    role: null,
    parentId: null,
    parentPath: null
  });

  const [staffDialogOpen, setStaffDialogOpen] = useState(false);
  const [staffOrgNodeId, setStaffOrgNodeId] = useState<string | null>(null);

  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteCtx, setInviteCtx] = useState<{ role: RoleTier | null; parentId: string | null }>({ role: null, parentId: null });

  const [manageTarget, setManageTarget] = useState<UserTreeNode | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchUserTree();
      const treeList = Array.isArray(data) ? data : ((data as any)?.tree || (data as any)?.data || []);
      setTree(Array.isArray(treeList) ? treeList : []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Could not load hierarchy');
      setTree([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openAddDialog(role: RoleTier | null = null, parentId: string | null = null, parentPath: string | null = null) {
    setSubDialogCtx({ role, parentId, parentPath });
    setSubDialogOpen(true);
  }

  function openAddStaff(orgNodeId: string) {
    setStaffOrgNodeId(orgNodeId);
    setStaffDialogOpen(true);
  }

  function openInvite(role: RoleTier, parentId: string) {
    setInviteCtx({ role, parentId });
    setInviteDialogOpen(true);
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1.5 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '1.25rem' }}>
            Account Hierarchy &amp; Role Scoping
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
            Multi-tenant distributor tree, dealer territory assignments, and staff organization node access
          </Typography>
        </Box>
        <Button variant="contained" size="small" startIcon={<PersonAddIcon />} onClick={() => openAddDialog()} sx={{ height: 34 }}>
          Add Subordinate Account
        </Button>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', height: '100%' }}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Typography color="error">{error}</Typography>
        ) : tree.length === 0 ? (
          <Typography color="text.secondary">No accounts in scope.</Typography>
        ) : (
          tree.map(node => (
            <UserTreeNodeView
              key={node.id}
              node={node}
              depth={0}
              onAddUnder={openAddDialog}
              onAddStaff={openAddStaff}
              onInvite={openInvite}
              onManage={setManageTarget}
            />
          ))
        )}
      </Box>

      <AddSubordinateDialog
        open={subDialogOpen}
        onClose={() => setSubDialogOpen(false)}
        onCreated={load}
        underRole={subDialogCtx.role}
        parentId={subDialogCtx.parentId}
        parentPath={subDialogCtx.parentPath}
      />
      <AddStaffDialog open={staffDialogOpen} onClose={() => setStaffDialogOpen(false)} onCreated={load} orgNodeId={staffOrgNodeId} />
      <InviteDialog
        open={inviteDialogOpen}
        onClose={() => setInviteDialogOpen(false)}
        underRole={inviteCtx.role}
        parentId={inviteCtx.parentId}
      />
      <ManageAccountDialog open={Boolean(manageTarget)} onClose={() => setManageTarget(null)} onChanged={load} target={manageTarget} />
    </Box>
  );
};
