import React, { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronRight, Droplets, Settings2, WifiOff, Wifi } from 'lucide-react-native';
import { useListPumps } from '@/api/generated/farmer';
import type { PumpResponse } from '@/api/generated/model';
import { colors, font, radius, shadow, space, TOUCH } from '@/shared/theme';
import { Banner } from '@/shared/ui/Banner';
import { OfflineBanner } from '@/shared/ui/OfflineBanner';
import { PillTone, StatusPill } from '@/shared/ui/StatusPill';
import { ScreenHeader } from '@/shared/ui/ScreenHeader';
import { StateView } from '@/shared/ui/StateView';
import { faultName } from '@/shared/i18n/faults';
import { friendlyError } from '@/shared/i18n/errors';
import { formatMinutes, timeAgo } from '@/shared/i18n/format';
import { useDirection } from '@/shared/i18n/useDirection';
import { useNow } from '@/shared/hooks/useOnline';
import { useStatusBar } from '@/shared/hooks/useStatusBar';
import { useRealtimeStatus } from '@/realtime/RealtimeProvider';
import { PumpScreen } from '@/features/pump/PumpScreen';
import { PumpState, displayName, groupBySite, pumpState } from './model';

const STATE_PILL: Record<
  PumpState,
  { tone: PillTone; key: string; icon?: React.ComponentType<{ size?: number; color?: string }> }
> = {
  running: { tone: 'ok', key: 'pumps.status.running' },
  stopped: { tone: 'idle', key: 'pumps.status.stopped' },
  fault: { tone: 'danger', key: 'pumps.status.fault', icon: AlertTriangle },
  offline: { tone: 'warn', key: 'pumps.status.offline', icon: WifiOff },
  nodata: { tone: 'idle', key: 'pumps.noData', icon: WifiOff },
};

const PumpCard: React.FC<{ pump: PumpResponse; now: number; onOpen: () => void }> = ({ pump, now, onOpen }) => {
  const { t } = useTranslation();
  const { flip } = useDirection();
  const state = pumpState(pump, now);
  const pill = STATE_PILL[state];
  const name = displayName(pump);
  const label = t(pill.key);
  const offline = state === 'offline' || state === 'nodata';

  return (
    <TouchableOpacity
      style={[styles.card, offline && styles.cardOffline]}
      onPress={onOpen}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={t('pumps.openPump', { name, status: label })}
      testID={`pump-card-${pump.id}`}
    >
      <View style={styles.cardMain}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={2}>
            {name}
          </Text>
        </View>
        <StatusPill tone={pill.tone} icon={pill.icon} label={label} />
        {state === 'fault' && pump.fault_code ? (
          <Text style={styles.fault}>{faultName(t, pump.fault_code)}</Text>
        ) : null}
        <Text style={styles.meta}>
          {pump.hp_rating ? `${t('pumps.hp', { hp: pump.hp_rating })} · ` : ''}
          {state === 'nodata' ? t('pumps.noData') : t('pumps.lastSeen', { ago: timeAgo(t, pump.last_seen_at, now) })}
        </Text>
        {pump.runtime_today_min ? (
          <Text style={styles.meta}>{t('pumps.ranToday', { time: formatMinutes(t, pump.runtime_today_min) })}</Text>
        ) : null}
      </View>
      <ChevronRight size={26} color={colors.textFaint} style={flip} />
    </TouchableOpacity>
  );
};

/**
 * The Pumps tab. One pump: it opens straight to that pump. Several: a list grouped by the farmer's
 * own sites, refreshed live and by pulling down.
 */
export const PumpsScreen: React.FC = () => {
  const { t } = useTranslation();
  const router = useRouter();
  const rt = useRealtimeStatus();
  const now = useNow(30_000);
  const [refreshing, setRefreshing] = useState(false);
  // Live updates arrive over the socket; poll only while it is down.
  const q = useListPumps(undefined, { query: { refetchInterval: rt === 'open' ? false : 30_000 } });
  useStatusBar('light');

  const pumps = useMemo(() => q.data?.pumps ?? [], [q.data]);
  const sections = useMemo(() => groupBySite(pumps), [pumps]);

  const refresh = async () => {
    setRefreshing(true);
    await q.refetch();
    setRefreshing(false);
  };

  if (q.isLoading && !q.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={t('pumps.title')} />
        <StateView kind="loading" title={t('pumps.loading')} />
      </SafeAreaView>
    );
  }

  if (q.isError && !q.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={t('pumps.title')} />
        <StateView
          kind="error"
          icon={AlertTriangle}
          title={t('common.serverUnreachableTitle')}
          message={friendlyError(q.error, t, 'load')}
          actionLabel={t('common.retry')}
          onAction={() => void q.refetch()}
        />
      </SafeAreaView>
    );
  }

  if (pumps.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={t('pumps.title')} onRefresh={() => void q.refetch()} refreshLabel={t('common.refresh')} />
        <StateView
          kind="empty"
          icon={Droplets}
          title={t('pumps.emptyTitle')}
          message={t('pumps.emptyMessage')}
          actionLabel={t('common.checkAgain')}
          onAction={() => void q.refetch()}
        />
      </SafeAreaView>
    );
  }

  if (pumps.length === 1) return <PumpScreen id={pumps[0].id} embedded />;

  const showTitles = sections.some((s) => s.title);
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title={t('pumps.title')}
        subtitle={t('pumps.count', { count: pumps.length })}
        onRefresh={refresh}
        refreshLabel={t('common.refresh')}
      />
      <OfflineBanner savedAt={q.dataUpdatedAt} />
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.primary]} />}
      >
        {q.isError ? <Banner tone="warn" text={t('live.refreshFailed')} /> : null}
        {rt !== 'open' && rt !== 'idle' ? <Banner tone="info" icon={Wifi} text={t('offline.reconnecting')} /> : null}
        {sections.map((section) => (
          <View key={section.key} style={styles.section}>
            {showTitles ? <Text style={styles.sectionTitle}>{section.title ?? t('pumps.ungrouped')}</Text> : null}
            {section.pumps.map((p) => (
              <PumpCard
                key={p.id}
                pump={p}
                now={now}
                onOpen={() => router.push({ pathname: '/pump/[id]', params: { id: p.id } })}
              />
            ))}
          </View>
        ))}
        <TouchableOpacity
          style={styles.manage}
          onPress={() => router.push('/manage')}
          accessibilityRole="button"
          testID="manage-pumps"
        >
          <Settings2 size={20} color={colors.primary} />
          <Text style={styles.manageText}>{t('pumps.manage')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.primary },
  list: { padding: space.lg, gap: space.lg, backgroundColor: colors.bg, flexGrow: 1 },
  section: { gap: space.md },
  sectionTitle: { color: colors.textMuted, fontSize: font.body, fontWeight: '800', marginTop: space.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    minHeight: TOUCH + 20,
    ...(shadow as object),
  },
  cardOffline: { backgroundColor: colors.surfaceAlt },
  cardMain: { flex: 1, gap: 6 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  name: { color: colors.text, fontSize: font.title, fontWeight: '900', flexShrink: 1 },
  fault: { color: colors.danger, fontSize: font.body, fontWeight: '800' },
  meta: { color: colors.textMuted, fontSize: font.body },
  manage: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: TOUCH,
    marginTop: space.sm,
  },
  manageText: { color: colors.primary, fontSize: font.body, fontWeight: '800' },
});
