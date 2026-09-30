import React, { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { getDeviceLanguage, getSavedLanguage, previewLanguage } from '@/shared/i18n';
import { useAuth } from '@/state/auth';
import { SplashScreen } from '@/screens/SplashScreen';

/** First screen: the splash, then language (first launch only), then login or the app. */
export default function Boot() {
  const router = useRouter();

  const onFinish = useCallback(async () => {
    const saved = await getSavedLanguage();
    if (!saved) {
      // First launch: the language comes before anything else.
      await previewLanguage(getDeviceLanguage());
      router.replace({ pathname: '/language', params: { mode: 'first' } });
      return;
    }
    // Wait for the stored session to be read, then go where the person belongs.
    const status = await new Promise<'signedIn' | 'signedOut'>((resolve) => {
      const current = useAuth.getState().status;
      if (current !== 'loading') return resolve(current);
      const unsub = useAuth.subscribe((s) => {
        if (s.status !== 'loading') {
          unsub();
          resolve(s.status);
        }
      });
    });
    router.replace(status === 'signedIn' ? '/(tabs)' : '/login');
  }, [router]);

  return <SplashScreen onFinish={onFinish} />;
}
