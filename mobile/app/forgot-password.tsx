import React from 'react';
import { useRouter } from 'expo-router';
import { useStatusBar } from '@/shared/hooks/useStatusBar';
import { ForgotPasswordScreen } from '@/screens/auth/ForgotPasswordScreen';

export default function ForgotPasswordRoute() {
  const router = useRouter();
  useStatusBar('dark');

  return (
    <ForgotPasswordScreen
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/login'))}
      onSent={() => router.push('/otp')}
    />
  );
}
