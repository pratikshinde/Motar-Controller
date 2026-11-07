import React from 'react';
import { useRouter } from 'expo-router';
import i18n, { isSupportedLanguage, syncLanguageToServer } from '@/shared/i18n';
import { useStatusBar } from '@/shared/hooks/useStatusBar';
import { ScanQrScreen } from '@/screens/auth/ScanQrScreen';

export default function ScanRoute() {
  const router = useRouter();
  useStatusBar('dark');

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
