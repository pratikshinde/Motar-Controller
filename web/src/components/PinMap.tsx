import React, { useEffect, useRef } from 'react';
import { Alert, Box, Chip } from '@mui/material';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface Pin {
  id: string;
  lat: number;
  lng: number;
  /** What the pin says when clicked. */
  label: string;
}

// One red pin for every pump that has a position.
const PIN = `data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='28' height='36' viewBox='0 0 28 36'>" +
    "<path fill='#d93025' d='M14 0C6.27 0 0 6.27 0 14c0 9.6 14 22 14 22S28 23.6 28 14C28 6.27 21.73 0 14 0z'/>" +
    "<circle cx='14' cy='14' r='5' fill='white'/></svg>"
)}`;
const ICON = L.icon({ iconUrl: PIN, iconSize: [28, 36], iconAnchor: [14, 36], popupAnchor: [0, -34] });

/** A map with a red pin for every pump that has a position, and how many there are. Nothing else. `pins` is null while loading. */
export const PinMap: React.FC<{ pins: Pin[] | null; error?: string }> = ({ pins, error }) => {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const m = L.map(host.current, { zoomControl: true }).setView([20.6, 78.9], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 18 }).addTo(m);
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    return () => {
      m.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const group = layer.current;
    if (!m || !group || !pins) return;
    group.clearLayers();
    const bounds: [number, number][] = [];
    for (const p of pins) {
      bounds.push([p.lat, p.lng]);
      const popup = document.createElement('div');
      popup.textContent = p.label;
      L.marker([p.lat, p.lng], { icon: ICON }).addTo(group).bindPopup(popup);
    }
    if (bounds.length) m.fitBounds(bounds, { padding: [48, 48], maxZoom: 13 });
  }, [pins]);

  return (
    <Box sx={{ position: 'relative', height: 'calc(100vh - 150px)', minHeight: 420, borderRadius: 3, overflow: 'hidden', border: 1, borderColor: 'divider' }}>
      <Box ref={host} data-testid="pin-map" sx={{ position: 'absolute', inset: 0 }} />
      <Chip
        data-testid="map-count"
        label={pins === null ? 'Loading…' : `${pins.length} ${pins.length === 1 ? 'pump' : 'pumps'} on the map`}
        sx={{ position: 'absolute', top: 14, right: 14, zIndex: 1100, fontWeight: 700, fontSize: '0.9rem', height: 34, bgcolor: 'background.paper', border: 1, borderColor: 'divider' }}
      />
      {error && (
        <Alert severity="error" sx={{ position: 'absolute', top: 60, right: 14, zIndex: 1100 }}>
          {error}
        </Alert>
      )}
    </Box>
  );
};
