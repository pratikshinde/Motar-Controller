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

  it('has a Login button in the header that opens the choice of roles', async () => {
    render(<MemoryRouter><HomeView /></MemoryRouter>);
    const login = screen.getByTestId('login-button');
    expect(login).toHaveTextContent('Login');
    expect(login.closest('header')).not.toBeNull();
    await userEvent.click(login);
    expect(mocks.navigate).toHaveBeenCalledWith('/login');
  });

  it('Get Started also opens the choice of roles', async () => {
    render(<MemoryRouter><HomeView /></MemoryRouter>);
    await userEvent.click(screen.getByTestId('get-started'));
    expect(mocks.navigate).toHaveBeenCalledWith('/login');
  });

  it('is the Ajanta Pump Controller page: name, the four features and the three steps', () => {
    render(<MemoryRouter><HomeView /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Ajanta Pump Controller');
    for (const f of ['Remote Control', 'Schedule Operation', 'Water & Energy Saving', 'Real-Time Monitoring']) expect(screen.getByText(f)).toBeInTheDocument();
    for (const s of ['Scan QR Code', 'Control Pump', 'Enjoy Benefits']) expect(screen.getByText(s)).toBeInTheDocument();
  });

  it('the menu links go to sections that exist on the page', () => {
    render(<MemoryRouter><HomeView /></MemoryRouter>);
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    for (const a of Array.from(nav.querySelectorAll('a'))) {
      const id = (a.getAttribute('href') || '').slice(1);
      expect(document.getElementById(id), `section #${id}`).not.toBeNull();
    }
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
