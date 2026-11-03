import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { StateView } from '@/shared/ui/StateView';
import { SwatiPage } from '@/shared/ui/SwatiPage';
import { AjantaScreen } from '@/shared/ui/AjantaScreen';
import { ajantaHome } from '@/config/ajantaHome';
import { useStatusBar } from '@/shared/hooks/useStatusBar';
import { useCurrentPump } from '@/features/pumps/useCurrentPump';
import { ScheduleEntryCard } from '@/features/schedule/ScheduleEntryCard';
import { TimerTab } from './TimerTab';

/** The page around the Timer content: Ajanta's banner with a back arrow, or Swati's plain page. */
const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const router = useRouter();
  useStatusBar('light');
  if (ajantaHome) {
    return (
      <AjantaScreen banner={{ title: t('nav.timer'), scene: 'pump', onBack: () => router.replace('/(tabs)') }}>
        {children}
      </AjantaScreen>
    );
  }
  return (
    <SwatiPage title={t('timer.title')} noBack>
      {children}
    </SwatiPage>
  );
};

/**
 * The Timer page of Swati's app. The pump's timer is "run for X minutes, rest for Y, repeat Z times": that is what the
 * controller supports, so that is what is shown and sent (the same real timer as everywhere else in the app).
 */
export const TimerScreen: React.FC = () => {
  const { t } = useTranslation();
  const { pump, loading, failed, refetch } = useCurrentPump();

  return (
    <Shell>
      {loading ? (
        <StateView kind="loading" title={t('common.loading')} />
      ) : failed ? (
        <StateView kind="error" title={t('common.serverUnreachableTitle')} actionLabel={t('common.retry')} onAction={refetch} />
      ) : pump ? (
        <View style={{ gap: 16 }}>
          <ScheduleEntryCard pump={pump} />
          <TimerTab pump={pump} />
        </View>
      ) : (
        <StateView kind="empty" title={t('pumps.emptyTitle')} message={t('pumps.emptyMessage')} />
      )}
    </Shell>
  );
};
