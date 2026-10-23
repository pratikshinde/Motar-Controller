import React from 'react';
import { Tabs } from 'expo-router';
import { TabBar } from '@/shared/ui/TabBar';

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props: any) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="alerts" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
