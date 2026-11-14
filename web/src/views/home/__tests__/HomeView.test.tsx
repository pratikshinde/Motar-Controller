import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', async importOriginal => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => mocks.navigate }));

import { HomeView } from '../HomeView';
import { RoleChooser } from '../../auth/RoleChooser';

beforeEach(() => mocks.navigate.mockReset());

describe('the home page', () => {
  it('has a lock icon in the header that opens the platform owner sign-in', async () => {
    render(<MemoryRouter><HomeView /></MemoryRouter>);
    const lock = screen.getByTestId('owner-lock');
    expect(lock).toHaveAccessibleName('Platform owner sign in');
    expect(lock.closest('header')).not.toBeNull();
    await userEvent.click(lock);
    expect(mocks.navigate).toHaveBeenCalledWith('/owner');
  });

  it('has one Login button in the page that opens the choice of roles', async () => {
    render(<MemoryRouter><HomeView /></MemoryRouter>);
    const login = screen.getByTestId('login-button');
    expect(login).toHaveTextContent('Login');
    expect(login.closest('header')).toBeNull();
    await userEvent.click(login);
    expect(mocks.navigate).toHaveBeenCalledWith('/login');
  });

  it('tells farmers to use the mobile app', () => {
    render(<MemoryRouter><HomeView /></MemoryRouter>);
    expect(screen.getByTestId('farmers-note')).toHaveTextContent(/mobile app/i);
  });
});

describe('the choice after Login', () => {
  it('offers Admin, Distributor and Dealer, and nothing for the platform owner', () => {
    render(<MemoryRouter><RoleChooser /></MemoryRouter>);
    for (const key of ['admin', 'distributor', 'dealer']) expect(screen.getByTestId(`role-${key}`)).toBeInTheDocument();
    expect(screen.queryByText(/platform owner/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('farmer-hint')).toHaveTextContent(/mobile app/i);
  });

  it.each([
    ['admin', '/login/admin'],
    ['distributor', '/login/distributor'],
    ['dealer', '/login/dealer']
  ])('%s opens its own sign-in', async (key, path) => {
    render(<MemoryRouter><RoleChooser /></MemoryRouter>);
    await userEvent.click(screen.getByTestId(`role-${key}`));
    expect(mocks.navigate).toHaveBeenCalledWith(path);
  });

  it('goes back to the home page', async () => {
    render(<MemoryRouter><RoleChooser /></MemoryRouter>);
    await userEvent.click(screen.getByTestId('back-home'));
    expect(mocks.navigate).toHaveBeenCalledWith('/');
  });
});
