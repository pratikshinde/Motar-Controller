import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

const mocks = vi.hoisted(() => ({ fetchUserTree: vi.fn(), navigate: vi.fn(), role: 'manufacturer', viewing: null as null | { key: string; name: string } }));

vi.mock('../../api/users', async importOriginal => ({ ...(await importOriginal<typeof import('../../api/users')>()), fetchUserTree: mocks.fetchUserTree }));
vi.mock('../../api/viewing', () => ({ useViewing: () => mocks.viewing }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'admin', role: mocks.role } }) }));
vi.mock('react-router-dom', async importOriginal => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => mocks.navigate }));

import { HierarchyView } from '../HierarchyView';
import { buildAppTheme } from '../../theme';
import type { RoleTier, UserTreeNode } from '../../types';

let n = 0;
const node = (role: RoleTier, name: string, children: UserTreeNode[] = [], over: Partial<UserTreeNode> = {}): UserTreeNode => ({
  id: `n${++n}`,
  full_name: name,
  phone_number: `+9190000${String(n).padStart(5, '0')}`,
  role,
  hierarchy_path: `/${name}`,
  parent_user_id: null,
  members: [],
  children,
  ...over
});

let suresh: UserTreeNode;
const tree = () => {
  suresh = node('distributor', 'Suresh Patil', [node('dealer', 'Ramesh Traders', [node('customer', 'Ganesh Jadhav'), node('customer', 'Sunita Pawar')])]);
  return [node('manufacturer', 'Ajanta Admin', [suresh, node('dealer', 'Direct Dealer'), node('customer', 'Deepak Gaikwad')])];
};

const open = (url = '/hierarchy') =>
  render(
    <ThemeProvider theme={buildAppTheme('dark')}>
      <MemoryRouter initialEntries={[url]}>
        <HierarchyView />
      </MemoryRouter>
    </ThemeProvider>
  );

beforeEach(() => {
  mocks.fetchUserTree.mockReset();
  mocks.navigate.mockReset();
  mocks.fetchUserTree.mockResolvedValue({ tree: tree() });
  mocks.role = 'manufacturer';
  mocks.viewing = null;
});

describe('Hierarchy', () => {
  it('shows the admin tree: distributors, the dealers under each, the farmers under each dealer', async () => {
    open();
    const tree = await screen.findByTestId('team-tree');
    expect(within(tree).getByText('Suresh Patil')).toBeInTheDocument();
    expect(within(tree).getByText('Ramesh Traders')).toBeInTheDocument();
    expect(within(tree).getByText('Ganesh Jadhav')).toBeInTheDocument();
    expect(within(tree).getByText('Direct Dealer')).toBeInTheDocument();
    expect(within(screen.getByTestId('team-root')).getByText('Ajanta Admin')).toBeInTheDocument();
    expect(screen.getByTestId('hierarchy-counts')).toHaveTextContent('1 distributors');
    expect(screen.getByTestId('hierarchy-counts')).toHaveTextContent('2 dealers');
    expect(screen.getByTestId('hierarchy-counts')).toHaveTextContent('3 farmers');
  });

  it('folds a branch when its arrow is clicked', async () => {
    open();
    const tree = await screen.findByTestId('team-tree');
    const dealer = within(tree).getByText('Ramesh Traders').closest('[data-testid^="branch-"]') as HTMLElement;
    await userEvent.click(within(dealer).getAllByRole('button', { name: /collapse/i })[0]);
    await vi.waitFor(() => expect(within(tree).queryByText('Ganesh Jadhav')).not.toBeInTheDocument());
  });

  it('opens a person dashboard when their name is clicked', async () => {
    open();
    await screen.findByTestId('team-tree');
    await userEvent.click(screen.getByTestId(`open-${suresh.id}`));
    expect(mocks.navigate).toHaveBeenCalledWith(`/people/${suresh.id}`);
  });

  it('has a back button to the dashboard', async () => {
    open();
    await userEvent.click(await screen.findByTestId('back-to-dashboard'));
    expect(mocks.navigate).toHaveBeenCalledWith('/dashboard');
  });

  it('shows a distributor only its own dealers and the farmers under each, with no distributors count', async () => {
    mocks.role = 'distributor';
    mocks.fetchUserTree.mockResolvedValue({ tree: [tree()[0].children[0]] });
    open();
    await screen.findByTestId('team-tree');
    expect(screen.getByTestId('hierarchy-counts')).not.toHaveTextContent('distributors');
    expect(screen.getByTestId('hierarchy-counts')).toHaveTextContent('1 dealers');
    expect(screen.getByTestId('hierarchy-counts')).toHaveTextContent('2 farmers');
  });

  it('shows one person branch when asked, and goes back to their dashboard', async () => {
    const t = tree();
    mocks.fetchUserTree.mockResolvedValue({ tree: t });
    open(`/hierarchy?of=${t[0].children[0].id}`);
    const tree_ = await screen.findByTestId('team-tree');
    expect(within(screen.getByTestId('team-root')).getByText('Suresh Patil')).toBeInTheDocument();
    expect(within(tree_).queryByText('Direct Dealer')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('back-to-dashboard'));
    expect(mocks.navigate).toHaveBeenCalledWith(`/people/${t[0].children[0].id}`);
  });

  it('is look-only for the platform owner while viewing one admin, with a back button to that admin dashboard', async () => {
    mocks.role = 'superadmin';
    mocks.viewing = { key: 'ajanta', name: 'Ajanta Pump Controller' };
    open();
    await screen.findByTestId('team-tree');
    expect(screen.getByRole('heading', { name: /ajanta pump controller: hierarchy/i })).toBeInTheDocument();
    expect(screen.queryByTestId(/^open-/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('back-to-dashboard'));
    expect(mocks.navigate).toHaveBeenCalledWith('/manufacturers/ajanta');
  });

  it('says so when nobody is under you yet', async () => {
    mocks.fetchUserTree.mockResolvedValue({ tree: [node('manufacturer', 'Ajanta Admin')] });
    open();
    expect(await screen.findByText(/nobody is under you yet/i)).toBeInTheDocument();
  });
});
