import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

const mocks = vi.hoisted(() => ({ fetchManufacturersOverview: vi.fn(), fetchPlatformMap: vi.fn(), setViewing: vi.fn(), navigate: vi.fn() }));

vi.mock('../../api/brands', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/brands')>()),
  fetchManufacturersOverview: mocks.fetchManufacturersOverview,
  fetchPlatformMap: mocks.fetchPlatformMap
}));
vi.mock('../../api/viewing', () => ({ setViewing: mocks.setViewing }));
vi.mock('@mui/x-charts/PieChart', () => ({ PieChart: () => <div data-testid="pie" /> }));
vi.mock('@mui/x-charts/BarChart', () => ({ BarChart: () => <div data-testid="bar" /> }));
vi.mock('react-router-dom', async importOriginal => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => mocks.navigate }));

const fakeMap = vi.hoisted(() => ({ setView: vi.fn(), fitBounds: vi.fn(), remove: vi.fn() }));
const marker = vi.hoisted(() => ({ addTo: vi.fn(), bindPopup: vi.fn() }));
const markerFn = vi.hoisted(() => vi.fn());
const group = vi.hoisted(() => ({ addTo: vi.fn(), clearLayers: vi.fn() }));
vi.mock('leaflet', () => ({
  default: {
    layerGroup: () => {
      group.addTo.mockReturnValue(group);
      return group;
    },
    map: () => {
      fakeMap.setView.mockReturnValue(fakeMap);
      return fakeMap;
    },
    tileLayer: () => ({ addTo: vi.fn() }),
    icon: () => ({}),
    marker: (...args: unknown[]) => {
      markerFn(...args);
      marker.addTo.mockReturnValue(marker);
      marker.bindPopup.mockReturnValue(marker);
      return marker;
    }
  }
}));
vi.mock('leaflet/dist/leaflet.css', () => ({}));

import { PlatformDashboardView } from '../platform/PlatformDashboardView';
import { ManufacturerDashboardView } from '../platform/ManufacturerDashboardView';
import { PlatformMapView } from '../platform/PlatformMapView';
import { buildAppTheme } from '../../theme';

const buckets = { total: 12, running: 5, stopped: 4, fault: 1, offline: 1, no_data: 1 };
const maker = (key: string, name: string, over: any = {}) => ({
  key, name, short_name: name, logo_url: null, primary_color: '#2e7d32', status: 'ACTIVE', owner: { name: 'Ajanta Admin', phone: null, email: 'admin@ajanta.test' },
  farmers: 30, team: 6, distributors: 2, dealers: 4, open_alerts: 0, pumps: buckets, gsm_pumps: 9, gsm_online: 7, joined: '2026-10-01T00:00:00Z', ...over
});
const overview = {
  manufacturers: [maker('ajanta', 'Ajanta Pump Controller'), maker('swati', 'SolarLogger', { owner: null })],
  totals: {
    ...buckets, farmers: 60, open_alerts: 0, manufacturers: 2, distributors: 4, dealers: 8, gsm_pumps: 18, gsm_online: 14,
    monthly_pumps: [
      { month: '2026-06', pumps: 0 }, { month: '2026-07', pumps: 1 }, { month: '2026-08', pumps: 2 },
      { month: '2026-09', pumps: 3 }, { month: '2026-10', pumps: 4 }, { month: '2026-11', pumps: 5 }
    ]
  }
};

const themed = (ui: React.ReactElement, url = '/') =>
  render(
    <ThemeProvider theme={buildAppTheme('dark')}>
      <MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>
    </ThemeProvider>
  );

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockReset());
  markerFn.mockReset();
  fakeMap.fitBounds.mockReset();
  mocks.fetchManufacturersOverview.mockResolvedValue(overview);
  mocks.fetchPlatformMap.mockResolvedValue({ total: 2, pumps: [{ id: 'P1', lat: 18.5, lng: 73.8, manufacturer: 'Ajanta' }, { id: 'P2', lat: 19, lng: 74, manufacturer: null }] });
});

describe('the platform owner dashboard', () => {
  it('shows the five numbers and nothing else among the tiles', async () => {
    themed(<PlatformDashboardView />);
    expect(within(await screen.findByTestId('tile-running')).getByText('5')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-manufacturers')).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-distributors')).getByText('4')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-dealers')).getByText('8')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-gsm')).getByText('18')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid^="tile-"]')).toHaveLength(5);
  });

  it('draws three graphs: pumps by state, pumps per manufacturer, new pumps per month', async () => {
    themed(<PlatformDashboardView />);
    expect(await screen.findByTestId('chart-status')).toBeInTheDocument();
    expect(screen.getByTestId('chart-manufacturers')).toBeInTheDocument();
    expect(screen.getByTestId('chart-monthly')).toBeInTheDocument();
  });
});

describe('one admin dashboard', () => {
  const open = (key = 'ajanta') =>
    themed(
      <Routes>
        <Route path="/manufacturers/:key" element={<ManufacturerDashboardView />} />
      </Routes>,
      `/manufacturers/${key}`
    );

  it('shows pumps supplied, distributors, dealers, farmers and the GSM pumps running', async () => {
    open();
    expect(within(await screen.findByTestId('tile-pumps')).getByText('12')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-distributors')).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-dealers')).getByText('4')).toBeInTheDocument();
    expect(within(screen.getByTestId('tile-farmers')).getByText('30')).toBeInTheDocument();
    const gsm = screen.getByTestId('tile-gsm');
    expect(within(gsm).getByText('7')).toBeInTheDocument();
    expect(gsm).toHaveTextContent('of 9 on GSM');
  });

  it('has a Hierarchy button that opens that admin team for looking only', async () => {
    open();
    await userEvent.click(await screen.findByTestId('open-hierarchy'));
    expect(mocks.setViewing).toHaveBeenCalledWith({ key: 'ajanta', name: 'Ajanta Pump Controller', color: '#2e7d32' });
    expect(mocks.navigate).toHaveBeenCalledWith('/hierarchy');
  });

  it('has a back button to the list', async () => {
    open();
    await userEvent.click(await screen.findByTestId('back-to-list'));
    expect(mocks.navigate).toHaveBeenCalledWith('/manufacturers');
  });

  it('has no hierarchy to open for an admin without a login', async () => {
    open('swati');
    expect(await screen.findByTestId('open-hierarchy')).toBeDisabled();
  });

  it('says plainly that an unknown manufacturer does not exist', async () => {
    open('nobody');
    expect(await screen.findByText(/no manufacturer called/i)).toBeInTheDocument();
  });
});

describe('the platform owner map', () => {
  beforeEach(() => group.clearLayers.mockReset());

  it('puts a red pin on every registered pump and says how many there are', async () => {
    themed(<PlatformMapView />);
    expect(await screen.findByText('2 pumps on the map')).toBeInTheDocument();
    expect(markerFn).toHaveBeenCalledTimes(2);
    expect(fakeMap.fitBounds).toHaveBeenCalled();
  });

  it('says 0 pumps on the map when none has a position', async () => {
    mocks.fetchPlatformMap.mockResolvedValue({ total: 0, pumps: [] });
    themed(<PlatformMapView />);
    expect(await screen.findByText('0 pumps on the map')).toBeInTheDocument();
  });
});
