import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Settings2 } from 'lucide-react-native';
import { colors } from '@/shared/theme';
import { PumpThumbnail } from '@/shared/ui/PumpThumbnail';
import { StateView } from '@/shared/ui/StateView';
import { SwatiPage } from '@/shared/ui/SwatiPage';
import { useDirection } from '@/shared/i18n/useDirection';
import { useNow } from '@/shared/hooks/useOnline';
import { useSelectedPump } from '@/state/selectedPump';
import { useCurrentPump } from './useCurrentPump';
import { PumpState, displayName, pumpState } from './model';

const CHIP: Record<PumpState, { bg: string; fg: string; key: string }> = {
  running: { bg: '#DCFCE7', fg: '#15803D', key: 'pumps.status.running' },
  stopped: { bg: '#F1F5F9', fg: '#475569', key: 'pumps.status.stopped' },
  fault: { bg: '#FEE2E2', fg: '#B91C1C', key: 'pumps.status.fault' },
  offline: { bg: '#FEF3C7', fg: '#92400E', key: 'pumps.status.offline' },
  nodata: { bg: '#FEF3C7', fg: '#92400E', key: 'pumps.noData' },
};

/** "My pumps": the farmer's pumps with type and state; tapping one makes it the pump the other screens show. */
export const MyPumpsScreen: React.FC = () => {
  const { t } = useTranslation();
  const router = useRouter();
  const { flip } = useDirection();
  const now = useNow(30_000);
  const select = useSelectedPump((s) => s.select);
  const { pump: current, pumps, loading, failed, refetch } = useCurrentPump();

  return (
    <SwatiPage title={t('pumps.title')} onRefresh={refetch}>
      {loading ? (
        <StateView kind="loading" title={t('pumps.loading')} />
      ) : failed ? (
        <StateView kind="error" title={t('common.serverUnreachableTitle')} actionLabel={t('common.retry')} onAction={refetch} />
      ) : pumps.length === 0 ? (
        <StateView kind="empty" title={t('pumps.emptyTitle')} message={t('pumps.emptyMessage')} />
      ) : (
        pumps.map((p) => {
          const chip = CHIP[pumpState(p, now)];
          const solar = p.device_type === 'SOLAR_VFD';
          return (
            <TouchableOpacity
              key={p.id}
              style={[styles.card, p.id === current?.id && styles.cardCurrent]}
              onPress={() => {
                select(p.id);
                router.replace('/(tabs)');
              }}
              activeOpacity={0.8}
              accessibilityRole="button"
              testID={`pump-card-${p.id}`}
            >
              <PumpThumbnail type={solar ? 'SOLAR_VFD' : '3PHASE'} size={50} />
              <View style={styles.info}>
                <Text style={styles.name} numberOfLines={2}>
                  {displayName(p)}
                </Text>
                <Text style={styles.spec}>
                  {[solar ? t('swati.typeSolar') : t('swati.type3Phase'), p.hp_rating ? t('pumps.hp', { hp: p.hp_rating }) : null]
                    .filter(Boolean)
                    .join(' • ')}
                </Text>
              </View>
              <View style={[styles.chip, { backgroundColor: chip.bg }]}>
                <Text style={[styles.chipText, { color: chip.fg }]}>{t(chip.key)}</Text>
              </View>
              <ChevronRight size={22} color="#94A3B8" style={flip} />
            </TouchableOpacity>
          );
        })
      )}
      {pumps.length > 0 ? (
        <TouchableOpacity style={styles.manageBtn} onPress={() => router.push('/manage')} accessibilityRole="button" activeOpacity={0.8}>
          <Settings2 size={18} color={colors.primary} />
          <Text style={styles.manageText}>{t('settings.managePumps')}</Text>
        </TouchableOpacity>
      ) : null}
    </SwatiPage>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    padding: 12,
  },
  cardCurrent: { borderColor: colors.primary },
  info: { flex: 1 },
  name: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  spec: { fontSize: 14, fontWeight: '600', color: '#64748B', marginTop: 2 },
  chip: { borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { fontSize: 13, fontWeight: '800' },
  manageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: '#FFFFFF',
    paddingVertical: 12,
  },
  manageText: { color: colors.primary, fontSize: 16, fontWeight: '800' },
});
