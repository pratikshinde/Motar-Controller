import React from 'react';
import { useTranslation } from 'react-i18next';
import { WifiOff } from 'lucide-react-native';
import { useOnline } from '../hooks/useOnline';
import { formatClock } from '../i18n/format';
import { Banner } from './Banner';

/**
 * Shown at the top of the main screens while the phone has no connection. `savedAt` is when the
 * data on screen was last fetched, so the farmer knows how old it is.
 */
export const OfflineBanner: React.FC<{ savedAt?: number | null }> = ({ savedAt }) => {
  const { t, i18n } = useTranslation();
  const online = useOnline();
  if (online) return null;
  const text = savedAt ? t('offline.banner', { time: formatClock(i18n.language, savedAt) }) : t('offline.bannerNoData');
  return <Banner tone="warn" icon={WifiOff} text={text} testID="offline-banner" />;
};
