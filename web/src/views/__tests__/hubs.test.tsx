import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ role: 'manufacturer', viewing: null as null | { key: string } }));

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ role: mocks.role, user: { id: 'u', role: mocks.role } }) }));
vi.mock('../../api/viewing', () => ({ useViewing: () => mocks.viewing }));
vi.mock('../TelemetryView', () => ({ TelemetryView: () => <div>live pumps page</div> }));
vi.mock('../DevicesView', () => ({ DevicesView: () => <div>devices page</div> }));
vi.mock('../FactoryStationView', () => ({ FactoryStationView: () => <div>factory page</div> }));

import { DevicesHub } from '../hubs';

const Where = () => <span data-testid="where">{useLocation().search}</span>;
const at = (ui: React.ReactElement, url = '/') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      {ui}
      <Where />
    </MemoryRouter>
  );

beforeEach(() => {
  mocks.role = 'manufacturer';
  mocks.viewing = null;
});

describe('Devices: the devices, how they are doing live, and for the admin only the factory station', () => {
  it('shows the admin all three tabs', () => {
    at(<DevicesHub />);
    expect(screen.getByTestId('hub-tab-devices')).toBeInTheDocument();
    expect(screen.getByTestId('hub-tab-live')).toBeInTheDocument();
    expect(screen.getByTestId('hub-tab-factory')).toBeInTheDocument();
  });

  it('shows a distributor or dealer the devices and the live pumps, without the factory station', async () => {
    for (const role of ['distributor', 'dealer']) {
      mocks.role = role;
      const { unmount } = at(<DevicesHub />);
      expect(screen.getByText('devices page')).toBeInTheDocument();
      expect(screen.queryByTestId('hub-tab-factory')).not.toBeInTheDocument();
      await userEvent.click(screen.getByTestId('hub-tab-live'));
      expect(screen.getByText('live pumps page')).toBeInTheDocument();
      unmount();
    }
  });

  it('opens the live pumps from the old telemetry link', () => {
    at(<DevicesHub />, '/devices?tab=live');
    expect(screen.getByText('live pumps page')).toBeInTheDocument();
  });
});
