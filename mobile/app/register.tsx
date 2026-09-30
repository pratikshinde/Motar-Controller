import React from 'react';
import { useRouter } from 'expo-router';
import { useStatusBar } from '@/shared/hooks/useStatusBar';
import { RegisterScreen } from '@/screens/auth/RegisterScreen';

export default function RegisterRoute() {
  const router = useRouter();
  useStatusBar('dark');

  return (
    <RegisterScreen
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/login'))}
      onSent={() => router.push('/otp')}
      onLoginLink={() => router.replace('/login')}
    />
  );
}
