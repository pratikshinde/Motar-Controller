import React, { useEffect, useRef } from 'react';
import { Box, Card } from '@mui/material';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { usePumps } from '../hooks/usePumps';

// Leaflet's default marker icon references image paths that don't survive
// a bundler; point them at the same CDN the pre-redesign page loaded
// Leaflet from, rather than wiring asset imports for three tiny PNGs.
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
});

export const MapView: React.FC = () => {
  const { pumps } = usePumps();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapRef.current = L.map(containerRef.current).setView([19.9975, 73.7898], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(mapRef.current);
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = pumps.map(p => {
      const marker = L.marker([Number(p.latitude), Number(p.longitude)]).addTo(mapRef.current!);
      marker.bindPopup(`<b>${p.name}</b><br>Status: ${p.status}<br>${p.id}`);
      return marker;
    });
  }, [pumps]);

  return (
    <Card elevation={1} sx={{ height: '100%', overflow: 'hidden' }}>
      <Box ref={containerRef} sx={{ width: '100%', height: '100%' }} />
    </Card>
  );
};
