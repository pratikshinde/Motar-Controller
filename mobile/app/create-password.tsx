import React from 'react';
import { useRouter } from 'expo-router';
import { useStatusBar } from '@/shared/hooks/useStatusBar';
import { CreatePasswordScreen } from '@/screens/auth/CreatePasswordScreen';

export default function CreatePasswordRoute() {
  const router = useRouter();
  useStatusBar('dark');

  return (
    <CreatePasswordScreen
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/login'))}
      onDone={() => router.replace('/registered')}
    />
  );
}
