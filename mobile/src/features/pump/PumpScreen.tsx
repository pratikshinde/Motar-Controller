import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronLeft, Droplets, RefreshCw } from 'lucide-react-native';
import { useGetPump } from '@/api/generated/farmer';
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
  const [tab, setTab] = useState<PumpTab>(initialTab ?? 'live');
  // The live connection keeps this current while it is open. When it is not (a network that drops it, a server
  // restart), the screen re-reads every few seconds instead of showing a state that may be a minute old.
  const rt = useRealtimeStatus();
  const q = useGetPump(id, { query: { refetchInterval: rt === 'open' ? 60_000 : 5_000 } });
  const [refreshing, setRefreshing] = useState(false);
  useStatusBar('dark');

  const pump = q.data?.pump;
  const notFound = (q.error as { response?: { status?: number } } | null)?.response?.status === 404;

  const refresh = async () => {
    setRefreshing(true);
    await q.refetch();
    setRefreshing(false);
  };

  const back = embedded ? undefined : () => (router.canGoBack() ? router.back() : router.replace('/'));

  const topBar = (
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
        {topBar}
        <StateView kind="loading" title={t('common.loading')} />
      </SafeAreaView>
    );
  }

  if (!pump) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        {topBar}
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
      {topBar}
      <OfflineBanner savedAt={q.dataUpdatedAt} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.primary]} />}
      >
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
        <ErrorBoundary>
          {tab === 'live' ? (
            <LiveTab
              pump={pump}
              onOpenFaults={() => setTab('faults')}
              onOpenTimer={() => setTab('timer')}
              onOpenHistory={() => setTab('history')}
              refreshFailed={q.isError}
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
  safe: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, minHeight: TOUCH },
  side: { width: TOUCH - 4 },
  iconBtn: { width: TOUCH - 8, height: TOUCH - 8, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', color: colors.text, fontSize: font.title, fontWeight: '900' },
  content: { padding: 16, paddingBottom: 40, gap: 16 },
});
