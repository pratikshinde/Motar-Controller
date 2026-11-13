import React, { useEffect, useState } from 'react';
import { fetchPlatformMap } from '../../api/brands';
import { PinMap, type Pin } from '../../components/PinMap';

/** The platform owner's map: every registered pump on the platform that has a position, one red pin each, and how many there are. */
export const PlatformMapView: React.FC = () => {
  const [pins, setPins] = useState<Pin[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    fetchPlatformMap()
      .then(res => live && setPins(res.pumps.map(p => ({ id: p.id, lat: p.lat, lng: p.lng, label: p.manufacturer ? `${p.id} · ${p.manufacturer}` : p.id }))))
      .catch((err: any) => {
        if (!live) return;
        setError(err?.message || 'Could not load the map');
        setPins([]);
      });
    return () => {
      live = false;
    };
  }, []);

  return <PinMap pins={pins} error={error} />;
};
