import React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import i18n, { isSupportedLanguage, LangCode } from '@/shared/i18n';
import { useAuth } from '@/state/auth';
import { useStatusBar } from '@/shared/hooks/useStatusBar';
import { LanguageScreen } from '@/screens/LanguageScreen';

export default function LanguageRoute() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const first = mode !== 'change';
  useStatusBar('dark');

  const initial: LangCode = isSupportedLanguage(i18n.language) ? i18n.language : 'en';

  return (
    <LanguageScreen
      initial={initial}
      mode={first ? 'first' : 'change'}
      onDone={() => {
        if (!first) return router.back();
        router.replace(useAuth.getState().status === 'signedIn' ? '/(tabs)' : '/login');
      }}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/settings'))}
    />
  );
}
