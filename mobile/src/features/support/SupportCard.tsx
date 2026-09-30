import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Headphones, Phone } from 'lucide-react-native';
import { useGetSupportContact } from '@/api/generated/farmer';
import { colors, font } from '@/shared/theme';
import { Card, CardTitle } from '@/shared/ui/Card';
import { BigActionButton } from '@/shared/ui/BigActionButton';
import { StateView } from '@/shared/ui/StateView';

const dial = (phone: string) => void Linking.openURL(`tel:${phone.replace(/\s+/g, '')}`);

/**
 * Call the dealer who services this pump. The number comes from the server; when the server has none
 * we say so and never show a made-up one.
 */
export const SupportCard: React.FC<{ pumpId: string }> = ({ pumpId }) => {
  const { t } = useTranslation();
  const q = useGetSupportContact(pumpId);
  const c = q.data;

  return (
    <Card>
      <CardTitle icon={Headphones} title={t('support.title')} />
      {q.isLoading && !c ? (
        <StateView kind="loading" title={t('common.loading')} />
      ) : q.isError && !c ? (
        <Text style={styles.message}>{t('support.loadFailed')}</Text>
      ) : (
        <View style={styles.stack}>
          {c?.dealer_phone ? (
            <>
              <Text style={styles.label}>{t('support.dealer')}</Text>
              <Text style={styles.name}>{c.dealer_name ?? c.dealer_phone}</Text>
              <BigActionButton
                icon={Phone}
                label={t('support.call', { name: c.dealer_name ?? c.dealer_phone })}
                onPress={() => dial(c.dealer_phone as string)}
                testID="call-dealer"
              />
            </>
          ) : (
            <Text style={styles.message} testID="no-dealer">
              {t('support.noDealer')}
            </Text>
          )}
          {c?.escalation_phone ? (
            <>
              <Text style={styles.label}>{t('support.company')}</Text>
              <BigActionButton
                icon={Phone}
                tone="neutral"
                label={t('support.call', { name: c.escalation_name ?? c.escalation_phone })}
                onPress={() => dial(c.escalation_phone as string)}
              />
            </>
          ) : null}
        </View>
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  stack: { gap: 10 },
  label: { color: colors.textMuted, fontSize: font.body, fontWeight: '700' },
  name: { color: colors.text, fontSize: font.title, fontWeight: '900' },
  message: { color: colors.textMuted, fontSize: font.body, lineHeight: 23 },
});
