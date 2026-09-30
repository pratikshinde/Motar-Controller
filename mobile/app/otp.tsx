import React from 'react';
import { useRouter } from 'expo-router';
import { useStatusBar } from '@/shared/hooks/useStatusBar';
import { useAuthFlow } from '@/state/authFlow';
import { OtpScreen } from '@/screens/auth/OtpScreen';

export default function OtpRoute() {
  const router = useRouter();
  useStatusBar('dark');
  const purpose = useAuthFlow((s) => s.purpose);

  return (
    <OtpScreen
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/login'))}
      onVerified={() => router.push(purpose === 'registration' ? '/create-password' : '/reset-password')}
    />
  );
}
