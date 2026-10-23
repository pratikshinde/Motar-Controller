import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Play, Square } from 'lucide-react-native';
import { useGetPumpHistory } from '@/api/generated/farmer';
import { colors } from '@/shared/theme';
import { StateView } from '@/shared/ui/StateView';
import { SwatiPage } from '@/shared/ui/SwatiPage';
import { formatClock, formatDate, formatMinutes } from '@/shared/i18n/format';
import { useNow } from '@/shared/hooks/useOnline';
import { useCurrentPump } from '@/features/pumps/useCurrentPump';
import { dailyBars } from './buckets';
import { dayKey, RunSession, sessionMinutes, sessionsFromReadings } from './sessions';

interface DayCard {
  key: string;
  /** Start and stop times: only known for the last 24 hours, where the pump's own readings are kept. */
  sessions: RunSession[];
  minutes: number;
  starts: number | null;
}

/** Pump history: one card per day with the run time, and the start and stop times of the runs that are on record. */
export const PumpHistoryScreen: React.FC = () => {
  const { t, i18n } = useTranslation();
  const now = useNow(60_000);
  const { pump, loading } = useCurrentPump();
  const runtimeToday = pump?.runtime_today_min;
  const runningNow = pump ? (pump.pump_on ?? null) : null;
  const day = useGetPumpHistory(pump?.id ?? '', { period: 'day' }, { query: { enabled: !!pump } });
  const week = useGetPumpHistory(pump?.id ?? '', { period: 'week' }, { query: { enabled: !!pump } });

  const cards = useMemo<DayCard[]>(() => {
    const todayKey = dayKey(now);
    const sessions = sessionsFromReadings(day.data?.records ?? [], now, runningNow);
    const byDay = new Map<string, RunSession[]>();
    for (const s of sessions) {
      const k = dayKey(s.startMs);
      byDay.set(k, [...(byDay.get(k) ?? []), s]);
    }
    const out: DayCard[] = [];
    // Days with start and stop times (from the readings of the last 24 hours).
    for (const [k, list] of [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
      const fromSessions = list.reduce((sum, s) => sum + sessionMinutes(s), 0);
      out.push({
        key: k,
        sessions: list,
        minutes: k === todayKey && runtimeToday != null ? runtimeToday : fromSessions,
        starts: list.length,
      });
    }
    // Earlier days: the daily totals the server keeps.
    const have = new Set(out.map((c) => c.key));
    for (const b of dailyBars(week.data?.records ?? []).reverse()) {
      if (have.has(b.day) || b.day === todayKey) continue;
      out.push({ key: b.day, sessions: [], minutes: b.minutes, starts: b.starts });
    }
    return out.sort((a, b) => b.key.localeCompare(a.key));
  }, [day.data, week.data, now, runtimeToday, runningNow]);

  const label = (key: string): string => {
    const today = dayKey(now);
    const yesterday = dayKey(now - 24 * 60 * 60 * 1000);
    const date = formatDate(i18n.language, `${key}T12:00:00`);
    if (key === today) return `${t('live.today')} - ${date}`;
    if (key === yesterday) return `${t('swati.yesterday')} - ${date}`;
    return date;
  };

  const busy = loading || day.isLoading || week.isLoading;

  return (
    <SwatiPage title={t('swati.history')}>
      {busy ? (
        <StateView kind="loading" title={t('common.loading')} />
      ) : cards.length === 0 ? (
        <StateView kind="empty" title={t('history.empty')} message={t('history.emptyHint')} />
      ) : (
        cards.map((c) => (
          <View key={c.key} style={styles.card}>
            <Text style={styles.date}>{label(c.key)}</Text>
            {c.sessions.map((s) => (
              <View key={s.startMs}>
                <View style={styles.row}>
                  <View style={[styles.dot, { backgroundColor: colors.ok }]}>
                    <Play size={14} color="#FFFFFF" fill="#FFFFFF" />
                  </View>
                  <Text style={styles.rowText}>{t('swati.started')}</Text>
                  <Text style={styles.time}>{formatClock(i18n.language, s.startMs)}</Text>
                </View>
                <View style={styles.row}>
                  <View style={[styles.dot, { backgroundColor: s.ongoing ? colors.ok : colors.danger }]}>
                    {s.ongoing ? <Play size={14} color="#FFFFFF" fill="#FFFFFF" /> : <Square size={12} color="#FFFFFF" fill="#FFFFFF" />}
                  </View>
                  <Text style={styles.rowText}>{s.ongoing ? t('swati.runningNow') : t('swati.stopped')}</Text>
                  <Text style={styles.time}>{s.ongoing ? '' : formatClock(i18n.language, s.endMs)}</Text>
                </View>
              </View>
            ))}
            <View style={styles.footer}>
              <Text style={styles.total}>
                {t('swati.totalRun')}: <Text style={styles.totalValue}>{formatMinutes(t, c.minutes)}</Text>
              </Text>
              {c.starts != null ? <Text style={styles.starts}>{t('history.starts', { count: c.starts })}</Text> : null}
            </View>
          </View>
        ))
      )}
    </SwatiPage>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    padding: 16,
    gap: 10,
  },
  date: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  dot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, fontSize: 16, fontWeight: '700', color: '#334155' },
  time: { fontSize: 16, fontWeight: '800', color: '#0F172A', fontVariant: ['tabular-nums'] },
  footer: { borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 10, gap: 2 },
  total: { fontSize: 15, fontWeight: '700', color: '#475569' },
  totalValue: { fontWeight: '900', color: '#0F172A' },
  starts: { fontSize: 14, fontWeight: '600', color: '#64748B' },
});
