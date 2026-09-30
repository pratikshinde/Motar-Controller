import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Query } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { CACHE_MAX_AGE_MS, persister, queryClient } from '@/api/queryClient';
import { setupQueryLifecycle } from '@/api/lifecycle';
import { RealtimeProvider } from '@/realtime/RealtimeProvider';
import i18n, { getSavedLanguage } from '@/shared/i18n';
import { useDirection } from '@/shared/i18n/useDirection';
import { ErrorBoundary } from '@/shared/ui/ErrorBoundary';
import { colors } from '@/shared/theme';
import { useAuth } from '@/state/auth';
import pkg from '../package.json';

const SIGNED_IN_AREAS = ['(tabs)', 'pump', 'manage'];

/** What is worth keeping for offline use: successful reads, minus bulky history and one-off command polls. */
const shouldDehydrateQuery = (query: Query): boolean =>
  query.state.status === 'success' && !/\/(history|commands\/)/.test(String(query.queryKey[0]));

/** Sends the person to the login screen whenever they are signed out while inside the app. */
function useAuthRedirect() {
  const status = useAuth((s) => s.status);
  const segments = useSegments();
  const router = useRouter();
  const navReady = !!useRootNavigationState()?.key;
  const area = segments[0] as string | undefined;

  useEffect(() => {
    if (!navReady || status !== 'signedOut') return;
    if (area && SIGNED_IN_AREAS.includes(area)) router.replace('/login');
  }, [navReady, status, area, router]);
}

export default function RootLayout() {
  const { dir } = useDirection(); // 'rtl' for Kashmiri: React Native mirrors every row inside it
  useAuthRedirect();

  useEffect(() => {
    void useAuth.getState().hydrate();
    // Show the saved language from the very first frame, including on the splash screen.
    void getSavedLanguage().then((code) => {
      if (code) void i18n.changeLanguage(code);
    });
    return setupQueryLifecycle();
  }, []);

  return (
    <SafeAreaProvider>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: CACHE_MAX_AGE_MS,
          buster: pkg.version,
          dehydrateOptions: { shouldDehydrateQuery },
        }}
      >
        <RealtimeProvider>
          <StatusBar style="dark" />
          <View style={[styles.root, { direction: dir }]}>
            <ErrorBoundary>
              <Stack
                screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'fade' }}
              />
            </ErrorBoundary>
          </View>
        </RealtimeProvider>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
