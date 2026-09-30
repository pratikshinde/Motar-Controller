import React, { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BellRing, CheckCircle2, Info, ShieldCheck } from 'lucide-react-native';
import { getListAlertsQueryKey, useAckAlert, useListAlerts, useResolveAlert } from '@/api/generated/farmer';
import type { AlertOut } from '@/api/generated/model';
import { colors, font, radius, shadow, space } from '@/shared/theme';
import { Banner } from '@/shared/ui/Banner';
import { BigActionButton } from '@/shared/ui/BigActionButton';
import { ConfirmSheet } from '@/shared/ui/ConfirmSheet';
import { OfflineBanner } from '@/shared/ui/OfflineBanner';
import { ScreenHeader } from '@/shared/ui/ScreenHeader';
import { SegmentedTabs } from '@/shared/ui/SegmentedTabs';
import { StateView } from '@/shared/ui/StateView';
import { PillTone, StatusPill } from '@/shared/ui/StatusPill';
import { faultName } from '@/shared/i18n/faults';
import { friendlyError } from '@/shared/i18n/errors';
import { formatDateTime, timeAgo } from '@/shared/i18n/format';
import { useStatusBar } from '@/shared/hooks/useStatusBar';

type Filter = 'active' | 'fixed';

const SEVERITY: Record<
  string,
  { tone: PillTone; key: string; icon: React.ComponentType<{ size?: number; color?: string }> }
> = {
  CRITICAL: { tone: 'danger', key: 'alerts.serious', icon: AlertTriangle },
  HIGH: { tone: 'danger', key: 'alerts.serious', icon: AlertTriangle },
  MEDIUM: { tone: 'warn', key: 'alerts.warning', icon: AlertTriangle },
  LOW: { tone: 'idle', key: 'alerts.info', icon: Info },
};

/** The alert's title is built on the phone from its fault code, so it is always in the user's language. */
const AlertCard: React.FC<{
  alert: AlertOut;
  busy: boolean;
  onOpen: () => void;
  onAck: () => void;
  onResolve: () => void;
}> = ({ alert, busy, onOpen, onAck, onResolve }) => {
  const { t, i18n } = useTranslation();
  const resolved = !!alert.resolved_at;
  const acked = !!alert.acknowledged_at;
  const sev = SEVERITY[(alert.severity ?? '').toUpperCase()] ?? SEVERITY.MEDIUM;
  // A connectivity alert has no fault code: reuse the same sentence the "Listen" button already speaks for an
  // offline pump, in every language, rather than falling through to the generic title.
  const title =
    alert.alert_type === 'OFFLINE'
      ? t('speech.offline', { name: alert.pump_name, ago: timeAgo(t, alert.last_occurred_at) })
      : alert.fault_code
        ? faultName(t, alert.fault_code)
        : t('alerts.defaultTitle');

  return (
    <View style={[styles.card, !resolved && sev.tone === 'danger' && styles.cardDanger]} testID={`alert-${alert.id}`}>
      <View style={styles.head}>
        <StatusPill
          tone={resolved ? 'ok' : sev.tone}
          icon={resolved ? CheckCircle2 : sev.icon}
          label={resolved ? t('alerts.resolved') : t(sev.key)}
          size="sm"
        />
        {acked && !resolved ? <StatusPill tone="idle" size="sm" icon={CheckCircle2} label={t('alerts.acked')} /> : null}
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.pump}>{alert.pump_name}</Text>
      <Text style={styles.when}>
        {t('alerts.last', { when: formatDateTime(i18n.language, alert.last_occurred_at) })}
      </Text>
      {(alert.occurrence_count ?? 1) > 1 ? (
        <Text style={styles.when}>{t('alerts.occurrences', { count: alert.occurrence_count })}</Text>
      ) : null}
      <View style={styles.actions}>
        <BigActionButton tone="neutral" label={t('alerts.openPump')} onPress={onOpen} testID={`open-${alert.id}`} />
        {!resolved && !acked ? (
          <BigActionButton
            tone="neutral"
            label={t('alerts.ack')}
            onPress={onAck}
            loading={busy}
            testID={`ack-${alert.id}`}
          />
        ) : null}
        {!resolved ? (
          <BigActionButton
            label={t('alerts.resolve')}
            onPress={onResolve}
            disabled={busy}
            testID={`resolve-${alert.id}`}
          />
        ) : null}
      </View>
    </View>
  );
};

/** Alerts for the farmer's pumps: see, acknowledge, mark fixed, or jump to the pump. */
export const AlertsScreen: React.FC = () => {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('active');
  const [confirming, setConfirming] = useState<AlertOut | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  useStatusBar('light');

  const q = useListAlerts({ unresolved_only: filter === 'active' });
  const refreshLists = () => void qc.invalidateQueries({ queryKey: getListAlertsQueryKey() });
  const ack = useAckAlert({ mutation: { onSuccess: refreshLists } });
  const resolve = useResolveAlert({ mutation: { onSuccess: refreshLists } });

  const rows = useMemo(() => {
    const all = q.data?.alerts ?? [];
    return filter === 'fixed' ? all.filter((a) => !!a.resolved_at) : all.filter((a) => !a.resolved_at);
  }, [q.data, filter]);

  const refresh = async () => {
    setRefreshing(true);
    await q.refetch();
    setRefreshing(false);
  };

  const error = ack.error ?? resolve.error;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={t('alerts.title')} onRefresh={refresh} refreshLabel={t('common.refresh')} />
      <OfflineBanner savedAt={q.dataUpdatedAt} />
      <View style={styles.body}>
        <View style={styles.tabs}>
          <SegmentedTabs
            options={[
              { key: 'active', label: t('alerts.tabActive') },
              { key: 'fixed', label: t('alerts.tabFixed') },
            ]}
            value={filter}
            onChange={setFilter}
          />
        </View>
        {q.isLoading && !q.data ? (
          <StateView kind="loading" title={t('alerts.loading')} />
        ) : q.isError && !q.data ? (
          <StateView
            kind="error"
            icon={AlertTriangle}
            title={t('common.serverUnreachableTitle')}
            message={friendlyError(q.error, t, 'load')}
            actionLabel={t('common.retry')}
            onAction={() => void q.refetch()}
          />
        ) : rows.length === 0 ? (
          <StateView
            kind="empty"
            icon={filter === 'active' ? ShieldCheck : BellRing}
            title={filter === 'active' ? t('alerts.emptyTitle') : t('alerts.emptyFixed')}
            message={filter === 'active' ? t('alerts.emptyMessage') : undefined}
          />
        ) : (
          <ScrollView
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.primary]} />}
          >
            {error ? <Banner tone="danger" text={friendlyError(error, t, 'command')} /> : null}
            {rows.map((a) => (
              <AlertCard
                key={a.id}
                alert={a}
                busy={
                  (ack.isPending && ack.variables?.id === a.id) || (resolve.isPending && resolve.variables?.id === a.id)
                }
                onOpen={() => router.push({ pathname: '/pump/[id]', params: { id: a.pump_id, tab: 'faults' } })}
                onAck={() => ack.mutate({ id: a.id })}
                onResolve={() => setConfirming(a)}
              />
            ))}
          </ScrollView>
        )}
      </View>

      <ConfirmSheet
        visible={confirming !== null}
        title={t('alerts.resolveTitle')}
        message={confirming ? `${confirming.pump_name}\n\n${t('alerts.resolveBody')}` : undefined}
        confirmLabel={t('alerts.resolveYes')}
        cancelLabel={t('dashboard.no')}
        busy={resolve.isPending}
        onConfirm={() => {
          if (!confirming) return;
          resolve.mutate(
            { id: confirming.id, data: { resolution_note: null } },
            { onSettled: () => setConfirming(null) },
          );
        }}
        onCancel={() => setConfirming(null)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.primary },
  body: { flex: 1, backgroundColor: colors.bg },
  tabs: { padding: space.lg, paddingBottom: 0 },
  list: { padding: space.lg, gap: space.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: 6,
    ...(shadow as object),
  },
  cardDanger: { borderColor: colors.danger, borderWidth: 1.5 },
  head: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 4 },
  title: { color: colors.text, fontSize: font.title, fontWeight: '900' },
  pump: { color: colors.primary, fontSize: font.bodyLg, fontWeight: '800' },
  when: { color: colors.textMuted, fontSize: font.body },
  actions: { gap: 10, marginTop: 10 },
});
