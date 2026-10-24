import React, { useEffect, useRef, useCallback } from 'react';
import { Box, Card, Typography, Chip, Stack } from '@mui/material';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { usePumps } from '../hooks/usePumps';
import { useTheme } from '@mui/material/styles';
import { effectiveStatus, STATUS_LABEL, type EffectiveStatus } from '../utils/pumpStatus';
import type { PumpListItem } from '../types';

// ─── Status colour helpers ────────────────────────────────────────────────────
// Keyed on EffectiveStatus (connectivity-aware — see utils/pumpStatus.ts), not the pump's raw `status`
// field: a pump that stopped reporting an hour ago still carries whatever it last said in `status`
// (running, faulted, ...), and every other screen already shows it as Offline instead. The map used to
// read `status` directly, so its own legend counts and pins disagreed with the rest of the app.
const STATUS_COLOR: Record<EffectiveStatus, string> = {
  RUNNING: '#2e7d32',   // green
  FAULT:   '#c62828',   // red
  OFFLINE: '#616161',   // grey
  STOPPED: '#ef6c00',   // orange/amber
  NO_DATA: '#9e9e9e',   // lighter grey — distinct from Offline (has reported before; this has not)
};

function pinSvg(color: string): string {
  // A filled circle pin with a white centre dot, exported as a data-URI.
  return `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='28' height='36' viewBox='0 0 28 36'>
    <path fill='${encodeURIComponent(color)}' d='M14 0C6.27 0 0 6.27 0 14c0 9.6 14 22 14 22S28 23.6 28 14C28 6.27 21.73 0 14 0z'/>
    <circle cx='14' cy='14' r='5' fill='white'/>
  </svg>`;
}

function makeIcon(status: EffectiveStatus): L.Icon {
  const color = STATUS_COLOR[status];
  return L.icon({
    iconUrl: pinSvg(color),
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -38],
  });
}

function popupHtml(p: PumpListItem): string {
  const status = effectiveStatus(p);
  const color = STATUS_COLOR[status];
  const fmt = (v: any, unit: string) =>
    v !== null && v !== undefined ? `${Number(v).toFixed(1)} ${unit}` : '—';

  const hasTelemetry = p.v_ry !== null && p.v_ry !== undefined;
  const telemetryRows = hasTelemetry
    ? `<tr><td>V R-Y / Y-B / B-R</td><td><b>${fmt(p.v_ry,'V')} / ${fmt(p.v_yb,'V')} / ${fmt(p.v_br,'V')}</b></td></tr>
       <tr><td>I R / Y / B</td><td><b>${fmt(p.i_r,'A')} / ${fmt(p.i_y,'A')} / ${fmt(p.i_b,'A')}</b></td></tr>`
    : '<tr><td colspan="2" style="opacity:.6;font-style:italic">No telemetry yet</td></tr>';

  const expiry = (p as any).subscription_expires_at;
  const expiryRow = expiry
    ? `<tr><td>Subscription</td><td>${new Date(expiry).toLocaleDateString()}</td></tr>`
    : '';

  return `<div style="min-width:200px;font-family:sans-serif;font-size:13px">
    <div style="font-weight:700;font-size:15px;margin-bottom:4px">${p.name}</div>
    <div style="font-family:monospace;font-size:11px;opacity:.7;margin-bottom:6px">${p.id}</div>
    <span style="display:inline-block;padding:2px 8px;border-radius:12px;background:${color}22;color:${color};font-weight:700;margin-bottom:8px">${STATUS_LABEL[status]}</span>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <tr><td style="opacity:.7">HP Rating</td><td><b>${p.hp_rating} HP · ${p.supply_type}</b></td></tr>
      ${telemetryRows}
      ${expiryRow}
    </table>
    <div style="margin-top:8px">
      <a href="/devices/${encodeURIComponent(p.id)}" style="color:#1976d2;text-decoration:none;font-weight:600">View detail →</a>
    </div>
  </div>`;
}

// ─── Component ────────────────────────────────────────────────────────────────
export const MapView: React.FC = () => {
  const theme = useTheme();
  const { pumps, stats, loading } = usePumps();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());

  // Initialise map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true }).setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update markers whenever pump list changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Only pumps with a known position: a missing one is not at (0, 0).
    const validPumps = pumps.filter(
      p => p.latitude !== null && p.longitude !== null && p.latitude !== '' && p.longitude !== ''
        && Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude))
        && (Number(p.latitude) !== 0 || Number(p.longitude) !== 0)
    );

    // Remove markers for pumps no longer in scope
    const currentIds = new Set(validPumps.map(p => p.id));
    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });

    // Add / update markers
    const bounds: [number, number][] = [];
    validPumps.forEach(p => {
      const lat = Number(p.latitude);
      const lng = Number(p.longitude);
      bounds.push([lat, lng]);

      const existing = markersRef.current.get(p.id);
      if (existing) {
        // Update icon colour if status changed
        existing.setIcon(makeIcon(effectiveStatus(p)));
        existing.setPopupContent(popupHtml(p));
      } else {
        const marker = L.marker([lat, lng], { icon: makeIcon(effectiveStatus(p)) })
          .addTo(map)
          .bindPopup(popupHtml(p), { maxWidth: 280 });
        markersRef.current.set(p.id, marker);
      }
    });

    // Auto fit map to all markers on first load
    if (bounds.length > 0 && markersRef.current.size === bounds.length) {
      try {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      } catch {
        // ignore invalid bounds
      }
    }
  }, [pumps]);

  // One exclusive count per pump (mirrors the same tally on Live Telemetry and the fleet dashboard),
  // rather than the raw `status` field this used to read directly.
  const statusCounts = { running: 0, fault: 0, offline: 0, stopped: 0, noData: 0 };
  for (const p of pumps) {
    const status = effectiveStatus(p);
    if (status === 'RUNNING') statusCounts.running++;
    else if (status === 'FAULT') statusCounts.fault++;
    else if (status === 'OFFLINE') statusCounts.offline++;
    else if (status === 'NO_DATA') statusCounts.noData++;
    else statusCounts.stopped++;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 2 }}>
      {/* Legend / stats bar */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, fontSize: '1.25rem' }}>
            GIS Fleet Geospatial Map
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
            Geographic distribution of installed irrigation pumps and live connectivity status pins
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Chip size="small" label={`${statusCounts.running} Running`} sx={{ bgcolor: 'secondaryContainer', color: 'onSecondaryContainer', fontWeight: 700, height: 24 }} />
          <Chip size="small" label={`${statusCounts.fault} Fault`} sx={{ bgcolor: 'errorContainer', color: 'onErrorContainer', fontWeight: 700, height: 24 }} />
          <Chip size="small" label={`${statusCounts.offline} Offline`} sx={{ bgcolor: 'background.surfaceVariant', color: 'text.secondary', fontWeight: 700, height: 24 }} />
          <Chip size="small" label={`${statusCounts.stopped} Stopped`} sx={{ bgcolor: 'tertiaryContainer', color: 'onTertiaryContainer', fontWeight: 700, height: 24 }} />
          {statusCounts.noData > 0 && (
            <Chip size="small" label={`${statusCounts.noData} No Signal`} sx={{ bgcolor: 'background.surfaceVariant', color: 'text.secondary', fontWeight: 700, height: 24 }} />
          )}
        </Box>
      </Box>

      {/* Map canvas */}
      <Card elevation={1} sx={{ flex: 1, overflow: 'hidden', borderRadius: 2, border: theme => `1px solid ${theme.palette.divider}` }}>
        {pumps.length === 0 && !loading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', height: '100%' }}>
            <Typography color="text.secondary">No GPS-enabled devices located in scope</Typography>
          </Box>
        ) : (
          <Box ref={containerRef} sx={{ width: '100%', height: '100%' }} />
        )}
      </Card>
    </Box>
  );
};
