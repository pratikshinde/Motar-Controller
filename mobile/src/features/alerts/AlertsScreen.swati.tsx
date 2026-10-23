import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronRight, Info, WifiOff } from 'lucide-react-native';
import { useListAlerts } from '@/api/generated/farmer';
import { colors } from '@/shared/theme';
import { StateView } from '@/shared/ui/StateView';
import { SwatiPage } from '@/shared/ui/SwatiPage';
import { faultName } from '@/shared/i18n/faults';
import { formatDateTime } from '@/shared/i18n/format';
import { useDirection } from '@/shared/i18n/useDirection';
import { useSelectedPump } from '@/state/selectedPump';

type Level = 'serious' | 'warning' | 'info';
type Filter = 'all' | Level;

const TONE: Record<Level, { bar: string; bg: string; fg: string }> = {
  serious: { bar: '#DC2626', bg: '#FEF2F2', fg: '#991B1B' },
  warning: { bar: '#D97706', bg: '#FFFBEB', fg: '#92400E' },
  info: { bar: '#2563EB', bg: '#EFF6FF', fg: '#1E40AF' },
};

const levelOf = (severity: string | null | undefined): Level => {
  const s = (severity ?? '').toUpperCase();
  if (s === 'CRITICAL' || s === 'HIGH') return 'serious';
  if (s === 'MEDIUM') return 'warning';
  return 'info';
};

/** Swati's alerts page: the farmer's open problems in plain words, serious ones first. Real alerts only. */
export const AlertsScreenSwati: React.FC = () => {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { flip } = useDirection();
  const select = useSelectedPump((s) => s.select);
  const [filter, setFilter] = useState<Filter>('all');
  const q = useListAlerts({ unresolved_only: true });

  const items = useMemo(
    () =>
      (q.data?.alerts ?? []).map((a) => {
        const level = levelOf(a.severity);
        const offline = a.alert_type === 'OFFLINE';
        const code = a.fault_code ?? null;
        return {
          id: a.id,
          pumpId: a.pump_id,
          level,
          offline,
          title: offline ? t('swati.offlineTitle') : code ? faultName(t, code) : t('alerts.defaultTitle'),
          detail: offline
            ? a.pump_name
            : code
              ? t(`faultInfo.code${code}.cause`, { defaultValue: t('faultInfo.unknown.cause') })
              : a.pump_name,
          when: formatDateTime(i18n.language, a.last_occurred_at),
        };
      }),
    [q.data, t, i18n.language],
  );

  const count = (l: Level) => items.filter((i) => i.level === l).length;
  const shown = items.filter((i) => filter === 'all' || i.level === filter);

  const pill = (key: Filter, label: string) => (
    <TouchableOpacity
      key={key}
      onPress={() => setFilter(key)}
      style={[styles.pill, filter === key && styles.pillOn]}
      accessibilityRole="button"
      accessibilityState={{ selected: filter === key }}
      activeOpacity={0.8}
    >
      <Text style={[styles.pillText, filter === key && styles.pillTextOn]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <SwatiPage title={t('alerts.title')} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <View style={styles.filters}>
        {pill('all', t('swati.filterAll'))}
        {pill('serious', `${t('alerts.serious')} ${count('serious')}`)}
        {pill('warning', `${t('alerts.warning')} ${count('warning')}`)}
      </View>

      {q.isLoading && !q.data ? (
        <StateView kind="loading" title={t('alerts.loading')} />
      ) : q.isError && !q.data ? (
        <StateView kind="error" title={t('common.serverUnreachableTitle')} actionLabel={t('common.retry')} onAction={() => void q.refetch()} />
      ) : shown.length === 0 ? (
        <StateView kind="empty" title={t('alerts.emptyTitle')} message={t('alerts.emptyMessage')} />
      ) : (
        shown.map((a) => {
          const tone = TONE[a.level];
          const Icon = a.offline ? WifiOff : a.level === 'info' ? Info : AlertTriangle;
          return (
            <TouchableOpacity
              key={a.id}
              style={[styles.card, { borderStartColor: tone.bar }]}
              activeOpacity={0.85}
              accessibilityRole="button"
              onPress={() => {
                select(a.pumpId);
                router.replace('/(tabs)');
              }}
            >
              <View style={[styles.iconWrap, { backgroundColor: tone.bg }]}>
                <Icon size={22} color={tone.bar} />
              </View>
              <View style={styles.body}>
                <Text style={styles.title}>{a.title}</Text>
                <Text style={styles.when}>{a.when}</Text>
                {a.detail ? (
                  <Text style={[styles.detail, { color: tone.fg }]} numberOfLines={3}>
                    {a.detail}
                  </Text>
                ) : null}
              </View>
              <ChevronRight size={20} color="#94A3B8" style={flip} />
            </TouchableOpacity>
          );
        })
      )}
    </SwatiPage>
  );
};

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill: { borderRadius: 20, borderWidth: 1.5, borderColor: '#CBD5E1', backgroundColor: '#FFFFFF', paddingHorizontal: 16, paddingVertical: 9 },
  pillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { fontSize: 15, fontWeight: '800', color: '#334155' },
  pillTextOn: { color: '#FFFFFF' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderStartWidth: 5,
    padding: 14,
  },
  iconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  when: { fontSize: 14, fontWeight: '600', color: '#64748B' },
  detail: { fontSize: 14, fontWeight: '600', marginTop: 2 },
});
