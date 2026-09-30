import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { isPumpTab, PumpScreen } from '@/features/pump/PumpScreen';

/** agripump://pump/<id>?tab=faults opens a pump straight on its Problems tab. */
export default function PumpRoute() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  if (!id) return null;
  return <PumpScreen key={`${id}-${tab ?? ''}`} id={String(id)} initialTab={isPumpTab(tab) ? tab : undefined} />;
}
