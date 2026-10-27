import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Check, ChevronRight, Settings2, Sun, Zap } from 'lucide-react-native';
import { PumpThumbnail } from '@/shared/ui/PumpThumbnail';
import { StateView } from '@/shared/ui/StateView';
import { SwatiPage } from '@/shared/ui/SwatiPage';
import { useDirection } from '@/shared/i18n/useDirection';
import { useNow } from '@/shared/hooks/useOnline';
import { useSelectedPump } from '@/state/selectedPump';
import { useCurrentPump } from './useCurrentPump';
import { PumpState, displayName, pumpState } from './model';

const CHIP: Record<PumpState, { bg: string; fg: string; dot: string; key: string }> = {
  running: { bg: '#DCFCE7', fg: '#15803D', dot: '#16A34A', key: 'pumps.status.running' },
  stopped: { bg: '#F1F5F9', fg: '#475569', dot: '#94A3B8', key: 'pumps.status.stopped' },
  fault: { bg: '#FEE2E2', fg: '#B91C1C', dot: '#DC2626', key: 'pumps.status.fault' },
  offline: { bg: '#FEF3C7', fg: '#92400E', dot: '#D97706', key: 'pumps.status.offline' },
  nodata: { bg: '#FEF3C7', fg: '#92400E', dot: '#D97706', key: 'pumps.noData' },
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
        <StateView
          kind="error"
          title={t('common.serverUnreachableTitle')}
          actionLabel={t('common.retry')}
          onAction={refetch}
        />
      ) : pumps.length === 0 ? (
        <StateView kind="empty" title={t('pumps.emptyTitle')} message={t('pumps.emptyMessage')} />
      ) : (
        pumps.map((p) => {
          const chip = CHIP[pumpState(p, now)];
          const solar = p.device_type === 'SOLAR_VFD';
          const isSelected = p.id === current?.id;

          return (
            <TouchableOpacity
              key={p.id}
              style={[styles.card, isSelected && styles.cardCurrent]}
              onPress={() => {
                select(p.id);
                router.replace('/(tabs)');
              }}
              activeOpacity={0.82}
              accessibilityRole="button"
              testID={`pump-card-${p.id}`}
            >
              <View style={styles.thumbWrapper}>
                <PumpThumbnail type={solar ? 'SOLAR_VFD' : '3PHASE'} size={52} />
                {isSelected && (
                  <View style={styles.activeCheckBadge}>
                    <Check size={10} color="#FFFFFF" strokeWidth={3} />
                  </View>
                )}
              </View>

              <View style={styles.info}>
                <View style={styles.titleRow}>
                  <Text style={styles.name} numberOfLines={1}>
                    {displayName(p)}
                  </Text>
                  {isSelected && (
                    <View style={styles.activeTag}>
                      <Text style={styles.activeTagText}>Active</Text>
                    </View>
                  )}
                </View>

                <View style={styles.specsRow}>
                  <View style={[styles.typeBadge, solar ? styles.typeBadgeSolar : styles.typeBadgeGrid]}>
                    {solar ? (
                      <Sun size={10} color="#B45309" style={{ marginRight: 3 }} />
                    ) : (
                      <Zap size={10} color="#1D4ED8" style={{ marginRight: 3 }} />
                    )}
                    <Text style={[styles.typeBadgeText, solar ? styles.typeBadgeTextSolar : styles.typeBadgeTextGrid]}>
                      {solar ? t('swati.typeSolar') : t('swati.type3Phase')}
                    </Text>
                  </View>
                  {p.hp_rating ? (
                    <Text style={styles.hpText}>{t('pumps.hp', { hp: p.hp_rating })}</Text>
                  ) : null}
                </View>
              </View>

              <View style={[styles.chip, { backgroundColor: chip.bg }]}>
                <View style={[styles.chipDot, { backgroundColor: chip.dot }]} />
                <Text style={[styles.chipText, { color: chip.fg }]}>{t(chip.key)}</Text>
              </View>

              <ChevronRight size={20} color="#94A3B8" style={flip} />
            </TouchableOpacity>
          );
        })
      )}

      {pumps.length > 0 ? (
        <TouchableOpacity
          style={styles.manageBtn}
          onPress={() => router.push('/manage')}
          accessibilityRole="button"
          activeOpacity={0.82}
        >
          <Settings2 size={18} color="#0D47A1" />
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
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    padding: 14,
    shadowColor: '#0F172A',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardCurrent: {
    borderColor: '#0D47A1',
    backgroundColor: '#FAF5FF',
    shadowOpacity: 0.08,
  },
  thumbWrapper: {
    position: 'relative',
  },
  activeCheckBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#0D47A1',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  info: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    fontSize: 16.5,
    fontWeight: '800',
    color: '#0F172A',
    flexShrink: 1,
  },
  activeTag: {
    backgroundColor: '#DBEAFE',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  activeTagText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#1D4ED8',
  },
  specsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  typeBadgeSolar: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  typeBadgeGrid: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  typeBadgeTextSolar: {
    color: '#B45309',
  },
  typeBadgeTextGrid: {
    color: '#1D4ED8',
  },
  hpText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '800',
  },
  manageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: '#0D47A1',
    backgroundColor: '#FFFFFF',
    paddingVertical: 13,
    marginTop: 8,
    shadowColor: '#0F172A',
    shadowOpacity: 0.03,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  manageText: {
    color: '#0D47A1',
    fontSize: 15,
    fontWeight: '800',
  },
});
