import React from 'react';
import { useRouter } from 'expo-router';
import { useStatusBar } from '@/shared/hooks/useStatusBar';
import { RegisteredScreen } from '@/screens/auth/RegisteredScreen';

export default function RegisteredRoute() {
  const router = useRouter();
  useStatusBar('dark');

  return <RegisteredScreen onContinue={() => router.replace('/(tabs)')} />;
}
