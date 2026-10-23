import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronLeft, Droplets, RefreshCw } from 'lucide-react-native';
import { useGetPump, useListAlerts } from '@/api/generated/farmer';
import { useRealtimeStatus } from '@/realtime/RealtimeProvider';
import { colors, font, TOUCH } from '@/shared/theme';
import { StateView } from '@/shared/ui/StateView';
import { OfflineBanner } from '@/shared/ui/OfflineBanner';
import { SegmentedTabs } from '@/shared/ui/SegmentedTabs';
import { friendlyError } from '@/shared/i18n/errors';
import { useDirection } from '@/shared/i18n/useDirection';
import { useStatusBar } from '@/shared/hooks/useStatusBar';
import { ErrorBoundary } from '@/shared/ui/ErrorBoundary';
import { displayName } from '@/features/pumps/model';
import { FaultsTab } from '@/features/faults/FaultsTab';
import { HistoryTab } from '@/features/history/HistoryTab';
import { TimerTab } from '@/features/timer/TimerTab';
import { SwatiTopBar } from '@/shared/ui/SwatiTopBar';
import { useAuth } from '@/state/auth';
import { brand } from '@/config/brand';
import { useSelectedPump } from '@/state/selectedPump';
import { LiveTab } from './LiveTab';

export type PumpTab = 'live' | 'timer' | 'history' | 'faults';
export const isPumpTab = (v: unknown): v is PumpTab =>
  v === 'live' || v === 'timer' || v === 'history' || v === 'faults';

/** One pump: Live, Timer, History and Problems. `embedded` = shown inside the Pumps tab (no back button). */
export const PumpScreen: React.FC<{ id: string; embedded?: boolean; initialTab?: PumpTab }> = ({
  id,
  embedded,
  initialTab,
}) => {
  const { t } = useTranslation();
  const router = useRouter();
  const { flip } = useDirection();
  const user = useAuth((s) => s.user);
  const [tab, setTab] = useState<PumpTab>(initialTab ?? 'live');
  // The other Swati screens (timer, history, technical details) are about the pump the farmer is looking at.
  useEffect(() => useSelectedPump.getState().select(id), [id]);
  const rt = useRealtimeStatus();
  const q = useGetPump(id, { query: { refetchInterval: rt === 'open' ? 60_000 : 5_000 } });
  const alertsQ = useListAlerts({ unresolved_only: true });
  const openAlerts = (alertsQ.data?.alerts ?? []).length;
  const [refreshing, setRefreshing] = useState(false);
  useStatusBar('light');

  const pump = q.data?.pump;
  const notFound = (q.error as { response?: { status?: number } } | null)?.response?.status === 404;

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([q.refetch(), alertsQ.refetch()]);
    setRefreshing(false);
  };

  const back = embedded ? undefined : () => (router.canGoBack() ? router.back() : router.replace('/'));

  // Swati's design greets the farmer by name and puts the bell and profile in its own header (embedded = the home tab).
  const swatiHeader = brand.design === 'swati' && !!embedded;
  const farmerFirstName = user?.full_name ? user.full_name.split(' ')[0] : '';

  const defaultTopBar = (
    <View style={styles.top}>
      <View style={styles.side}>
        {back ? (
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={back}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            activeOpacity={0.7}
          >
            <ChevronLeft size={28} color={colors.text} style={flip} />
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
        {pump ? displayName(pump) : ''}
      </Text>
      <View style={[styles.side, { alignItems: 'flex-end' }]}>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={refresh}
          accessibilityRole="button"
          accessibilityLabel={t('common.refresh')}
          activeOpacity={0.7}
        >
          <RefreshCw size={22} color={colors.text} />
        </TouchableOpacity>
      </View>
    </View>
  );

  if (q.isLoading && !q.data) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        {swatiHeader ? (
          <SwatiTopBar
            farmerName={farmerFirstName}
            unreadAlerts={openAlerts}
            onPressAlerts={() => router.push('/alerts')}
            onPressProfile={() => router.push('/settings')}
          />
        ) : (
          defaultTopBar
        )}
        <StateView kind="loading" title={t('common.loading')} />
      </SafeAreaView>
    );
  }

  if (!pump) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        {swatiHeader ? (
          <SwatiTopBar
            farmerName={farmerFirstName}
            unreadAlerts={openAlerts}
            onPressAlerts={() => router.push('/alerts')}
            onPressProfile={() => router.push('/settings')}
          />
        ) : (
          defaultTopBar
        )}
        <StateView
          kind={notFound ? 'empty' : 'error'}
          icon={notFound ? Droplets : AlertTriangle}
          title={notFound ? t('pump.notFoundTitle') : t('dashboard.cantReachTitle')}
          message={notFound ? t('pump.notFoundMessage') : friendlyError(q.error, t, 'load')}
          actionLabel={notFound ? undefined : t('common.retry')}
          onAction={notFound ? undefined : () => void q.refetch()}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {swatiHeader ? (
        <SwatiTopBar
          farmerName={farmerFirstName}
          unreadAlerts={openAlerts}
          onPressAlerts={() => router.push('/alerts')}
          onPressProfile={() => router.push('/settings')}
        />
      ) : (
        defaultTopBar
      )}
      <OfflineBanner savedAt={q.dataUpdatedAt} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.primary]} />}
      >
        {!embedded && (
          <SegmentedTabs
            options={[
              { key: 'live', label: t('pump.tabs.live') },
              { key: 'timer', label: t('pump.tabs.timer') },
              { key: 'history', label: t('pump.tabs.history') },
              { key: 'faults', label: t('pump.tabs.faults') },
            ]}
            value={tab}
            onChange={setTab}
          />
        )}
        <ErrorBoundary>
          {tab === 'live' ? (
            <LiveTab
              pump={pump}
              onOpenFaults={() => router.push('/alerts')}
              onOpenTimer={() => router.push('/timer')}
              onOpenHistory={() => router.push('/history')}
              refreshFailed={q.isError}
              onRefresh={() => void refresh()}
            />
          ) : null}
          {tab === 'timer' ? <TimerTab pump={pump} /> : null}
          {tab === 'history' ? <HistoryTab pump={pump} /> : null}
          {tab === 'faults' ? <FaultsTab pump={pump} /> : null}
        </ErrorBoundary>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, minHeight: TOUCH, backgroundColor: '#FFFFFF' },
  side: { width: TOUCH - 4 },
  iconBtn: { width: TOUCH - 8, height: TOUCH - 8, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', color: '#0F172A', fontSize: font.title, fontWeight: '900' },
  content: { paddingBottom: 40, backgroundColor: '#F8FAFC' },
});
