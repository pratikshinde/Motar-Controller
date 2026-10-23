import React from 'react';
import { useTranslation } from 'react-i18next';
import { StateView } from '@/shared/ui/StateView';
import { SwatiPage } from '@/shared/ui/SwatiPage';
import { useCurrentPump } from '@/features/pumps/useCurrentPump';
import { TimerTab } from './TimerTab';

/**
 * The Timer page of Swati's app. The pump's timer is "run for X minutes, rest for Y, repeat Z times": that is what the
 * controller supports, so that is what is shown and sent (the same real timer as everywhere else in the app).
 */
export const TimerScreen: React.FC = () => {
  const { t } = useTranslation();
  const { pump, loading, failed, refetch } = useCurrentPump();

  return (
    <SwatiPage title={t('timer.title')} noBack>
      {loading ? (
        <StateView kind="loading" title={t('common.loading')} />
      ) : failed ? (
        <StateView kind="error" title={t('common.serverUnreachableTitle')} actionLabel={t('common.retry')} onAction={refetch} />
      ) : pump ? (
        <TimerTab pump={pump} />
      ) : (
        <StateView kind="empty" title={t('pumps.emptyTitle')} message={t('pumps.emptyMessage')} />
      )}
    </SwatiPage>
  );
};
