import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { PendingRegistrations } from '../people/PendingRegistrations';
import { buildAppTheme } from '../../theme';

const item = (id: string, status: string, name = 'Suresh Patil') => ({
  id, role: 'dealer' as const, full_name: name, address: 'Pune', phone_number: '+919876543210', status: status as any,
  created_at: new Date(Date.now() - 3_600_000).toISOString(), expires_at: null, scanned_at: null
});
const open = (items: any[], onContinue = vi.fn(), onCancel = vi.fn()) =>
  render(<ThemeProvider theme={buildAppTheme('dark')}><PendingRegistrations items={items} onContinue={onContinue} onCancel={onCancel} /></ThemeProvider>);

describe('registrations that are not finished', () => {
  it('shows nothing when there are none', () => {
    const { container } = open([]);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists each with where it stands and how long ago it started', () => {
    open([item('1', 'WAITING'), item('2', 'SCANNED', 'Mahesh Kale'), item('3', 'BLOCKED', 'Anil Agro')]);
    expect(screen.getByTestId('pending-registrations')).toHaveTextContent('Waiting to finish (3)');
    expect(within(screen.getByTestId('pending-1')).getByText('Waiting for the QR to be scanned')).toBeInTheDocument();
    expect(screen.getByTestId('pending-1')).toHaveTextContent('Started 1 hour ago');
    expect(within(screen.getByTestId('pending-2')).getByText('Scanned: they are choosing a password')).toBeInTheDocument();
    expect(within(screen.getByTestId('pending-3')).getByText('Blocked: too many wrong tries')).toBeInTheDocument();
  });

  it('continues or cancels the one that was clicked', async () => {
    const onContinue = vi.fn();
    const onCancel = vi.fn();
    const rows = [item('1', 'WAITING'), item('2', 'SCANNED', 'Mahesh Kale')];
    open(rows, onContinue, onCancel);
    await userEvent.click(screen.getByTestId('continue-2'));
    expect(onContinue).toHaveBeenCalledWith(rows[1]);
    await userEvent.click(screen.getByTestId('cancel-1'));
    expect(onCancel).toHaveBeenCalledWith(rows[0]);
  });
});
