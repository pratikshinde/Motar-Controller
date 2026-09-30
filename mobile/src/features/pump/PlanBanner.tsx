import React from 'react';
import { useTranslation } from 'react-i18next';
import { PauseCircle } from 'lucide-react-native';
import type { PumpResponse } from '@/api/generated/model';
import { formatDate } from '@/shared/i18n/format';
import { Banner } from '@/shared/ui/Banner';
import { planState } from '@/features/pumps/model';

/** Plan expiry warning (from 7 days before), the expired notice, and why remote control is paused. */
export const PlanBanner: React.FC<{
  pump: Pick<PumpResponse, 'lifecycle_state' | 'subscription_expires_at'>;
  now?: number;
}> = ({ pump, now }) => {
  const { t, i18n } = useTranslation();
  const plan = planState(pump, now);
  switch (plan.kind) {
    case 'suspended':
      return <Banner tone="danger" icon={PauseCircle} text={t('plan.suspended')} testID="plan-suspended" />;
    case 'expired':
      return (
        <Banner
          tone="warn"
          text={t('plan.expired', { date: formatDate(i18n.language, plan.expiresAt) })}
          testID="plan-expired"
        />
      );
    case 'expiring':
      return (
        <Banner
          tone="warn"
          text={
            plan.daysLeft <= 1
              ? t('plan.expiresToday')
              : t('plan.expiring', { days: plan.daysLeft, date: formatDate(i18n.language, plan.expiresAt) })
          }
          testID="plan-expiring"
        />
      );
    default:
      return null;
  }
};
