import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ userId: 'u1' as string | null, fetchMyBrand: vi.fn() }));

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: mocks.userId ? { id: mocks.userId } : null }) }));
vi.mock('../../api/brands', () => ({ fetchMyBrand: mocks.fetchMyBrand }));

import { PLATFORM_NAME, useBrandName } from '../useBrandName';

const Name = () => <span data-testid="name">{useBrandName()}</span>;

beforeEach(() => {
  mocks.fetchMyBrand.mockReset();
});

describe('the name on the website', () => {
  it('is Pump Controller for the platform owner, who belongs to no manufacturer', async () => {
    mocks.userId = 'super-1';
    mocks.fetchMyBrand.mockResolvedValue({ brand: null });
    render(<Name />);
    expect(await screen.findByText(PLATFORM_NAME)).toBeInTheDocument();
    expect(PLATFORM_NAME).toBe('Pump Controller');
  });

  it('is the manufacturer own name for its admin, distributors and dealers', async () => {
    mocks.userId = 'ajanta-admin';
    mocks.fetchMyBrand.mockResolvedValue({ brand: { key: 'ajanta', name: 'Ajanta Pump Controller' } });
    const first = render(<Name />);
    expect(await screen.findByText('Ajanta Pump Controller')).toBeInTheDocument();
    first.unmount();

    mocks.userId = 'swati-admin';
    mocks.fetchMyBrand.mockResolvedValue({ brand: { key: 'swati', name: 'Swati Pump Controller' } });
    render(<Name />);
    expect(await screen.findByText('Swati Pump Controller')).toBeInTheDocument();
    expect(screen.queryByText('Ajanta Pump Controller')).not.toBeInTheDocument();
  });

  it('falls back to Pump Controller when the name cannot be read, never to another manufacturer', async () => {
    mocks.userId = 'someone-else';
    mocks.fetchMyBrand.mockRejectedValue(new Error('offline'));
    render(<Name />);
    expect(await screen.findByText('Pump Controller')).toBeInTheDocument();
  });

  it('is Pump Controller before anyone has signed in, without asking the server', () => {
    mocks.userId = null;
    render(<Name />);
    expect(screen.getByTestId('name')).toHaveTextContent('Pump Controller');
    expect(mocks.fetchMyBrand).not.toHaveBeenCalled();
  });
});
