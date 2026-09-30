import React from 'react';
import { useRouter } from 'expo-router';
import { useStatusBar } from '@/shared/hooks/useStatusBar';
import { ResetPasswordScreen } from '@/screens/auth/ResetPasswordScreen';

export default function ResetPasswordRoute() {
  const router = useRouter();
  useStatusBar('dark');

  return (
    <ResetPasswordScreen
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/login'))}
      onDone={() => router.replace('/password-updated')}
    />
  );
}
