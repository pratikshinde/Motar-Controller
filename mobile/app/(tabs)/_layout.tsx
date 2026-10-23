import React from 'react';
import { Tabs } from 'expo-router';
import { TabBar } from '@/shared/ui/TabBar';
import { brand } from '@/config/brand';

export default function TabsLayout() {
  const swati = brand.design === 'swati';
  return (
    <Tabs tabBar={(props: any) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      {/* Swati: Home, Timer, More (alerts open from the bell). Classic: Pumps, Alerts, Settings. */}
      <Tabs.Screen name="timer" options={swati ? undefined : { href: null }} />
      <Tabs.Screen name="alerts" options={swati ? { href: null } : undefined} />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
