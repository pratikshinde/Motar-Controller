import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';

const mocks = vi.hoisted(() => ({ pumps: [] as any[], loading: false, error: null as string | null }));
vi.mock('../../hooks/usePumps', () => ({ usePumps: () => ({ pumps: mocks.pumps, loading: mocks.loading, error: mocks.error }) }));

const group = vi.hoisted(() => ({ addTo: vi.fn(), clearLayers: vi.fn() }));
const fakeMap = vi.hoisted(() => ({ setView: vi.fn(), fitBounds: vi.fn(), remove: vi.fn() }));
const marker = vi.hoisted(() => ({ addTo: vi.fn(), bindPopup: vi.fn() }));
const markerFn = vi.hoisted(() => vi.fn());
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

import { PortalMapView } from '../people/PortalMapView';
import { buildAppTheme } from '../../theme';

const pump = (id: string, lat: any, lng: any) => ({ id, name: `Pump ${id}`, latitude: lat, longitude: lng });
const open = () => render(<ThemeProvider theme={buildAppTheme('dark')}><PortalMapView /></ThemeProvider>);

beforeEach(() => {
  markerFn.mockReset();
  fakeMap.fitBounds.mockReset();
  mocks.loading = false;
  mocks.error = null;
  mocks.pumps = [pump('A', '18.5008', '73.9379'), pump('B', 13.3401, 77.1006), pump('C', null, null), pump('D', '', ''), pump('E', 'x', 'y')];
});

describe('the map of an admin, a distributor or a dealer', () => {
  it('puts a red pin on each pump that has a position and says how many', async () => {
    open();
    expect(await screen.findByText('2 pumps on the map')).toBeInTheDocument();
    expect(markerFn).toHaveBeenCalledTimes(2);
    expect(fakeMap.fitBounds).toHaveBeenCalled();
  });

  it('leaves out a pump with no usable position instead of pinning it at 0, 0', async () => {
    open();
    await screen.findByText('2 pumps on the map');
    const placed = markerFn.mock.calls.map(c => c[0]);
    expect(placed).toEqual([[18.5008, 73.9379], [13.3401, 77.1006]]);
  });

  it('says 0 pumps on the map when none has a position yet', async () => {
    mocks.pumps = [pump('C', null, null)];
    open();
    expect(await screen.findByText('0 pumps on the map')).toBeInTheDocument();
    expect(markerFn).not.toHaveBeenCalled();
  });

  it('says it is loading until the pumps are known', async () => {
    mocks.loading = true;
    open();
    expect(await screen.findByText('Loading…')).toBeInTheDocument();
  });
});
