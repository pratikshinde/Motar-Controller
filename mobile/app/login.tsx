import React from 'react';
import { useRouter } from 'expo-router';
import i18n, { isSupportedLanguage, syncLanguageToServer } from '@/shared/i18n';
import { useStatusBar } from '@/shared/hooks/useStatusBar';
import { LoginScreen } from '@/screens/LoginScreen';

export default function LoginRoute() {
  const router = useRouter();
  useStatusBar('dark');

  return (
    <LoginScreen
      onLoginSuccess={() => {
        // The language picked before login now has an account to attach to.
        if (isSupportedLanguage(i18n.language)) void syncLanguageToServer(i18n.language);
        router.replace('/(tabs)');
      }}
      onForgotPassword={() => router.push('/forgot-password')}
      onRegister={() => router.push('/register')}
    />
  );
}
