import React from 'react';
import { useRouter } from 'expo-router';
import { useStatusBar } from '@/shared/hooks/useStatusBar';
import { PasswordUpdatedScreen } from '@/screens/auth/PasswordUpdatedScreen';

export default function PasswordUpdatedRoute() {
  const router = useRouter();
  useStatusBar('dark');

  return <PasswordUpdatedScreen onGoToLogin={() => router.replace('/login')} />;
}
