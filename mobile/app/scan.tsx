import React from 'react';
import { Redirect, useRouter } from 'expo-router';
import i18n, { isSupportedLanguage, syncLanguageToServer } from '@/shared/i18n';
import { useStatusBar } from '@/shared/hooks/useStatusBar';
import { ScanQrScreen } from '@/screens/auth/ScanQrScreen';
import { brand } from '@/config/brand';

export default function ScanRoute() {
  const router = useRouter();
  useStatusBar('dark');

  // A brand without QR sign-in (SolarLogger) has no scanner: the route goes back to the login screen.
  if (!brand.features?.qrScan) return <Redirect href="/login" />;

  return (
    <ScanQrScreen
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/login'))}
      onSignedIn={() => {
        // The language picked before sign-in now has an account to attach to.
        if (isSupportedLanguage(i18n.language)) void syncLanguageToServer(i18n.language);
        router.replace('/(tabs)');
      }}
    />
  );
}
