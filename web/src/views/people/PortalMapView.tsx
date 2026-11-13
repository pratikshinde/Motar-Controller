import React, { useMemo } from 'react';
import { usePumps } from '../../hooks/usePumps';
import { PinMap, type Pin } from '../../components/PinMap';

/** The map for an admin, a distributor or a dealer: a red pin for every pump under them that has a position (the farmer's address, looked up when
 *  the farmer was registered), and how many there are. */
export const PortalMapView: React.FC = () => {
  const { pumps, loading, error } = usePumps();
  const pins: Pin[] | null = useMemo(() => {
    if (loading) return null;
    return pumps
      .filter(p => p.latitude !== null && p.latitude !== '' && p.longitude !== null && p.longitude !== '' && Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude)))
      .map(p => ({ id: p.id, lat: Number(p.latitude), lng: Number(p.longitude), label: `${p.name} · ${p.id}` }));
  }, [pumps, loading]);
  return <PinMap pins={pins} error={error || undefined} />;
};
