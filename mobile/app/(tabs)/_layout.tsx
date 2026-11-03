import React from 'react';
import { Tabs } from 'expo-router';
import { TabBar } from '@/shared/ui/TabBar';
import { brand } from '@/config/brand';
import { ajantaHome } from '@/config/ajantaHome';

export default function TabsLayout() {
  const homeTabs = brand.design === 'swati' || ajantaHome;
  return (
    <Tabs tabBar={(props: any) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      {/* Swati and Ajanta: Home, Timer, More (alerts open from the bell). Classic: Pumps, Alerts, Settings. */}
      <Tabs.Screen name="timer" options={homeTabs ? undefined : { href: null }} />
      <Tabs.Screen name="alerts" options={homeTabs ? { href: null } : undefined} />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
