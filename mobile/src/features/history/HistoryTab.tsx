import React, { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BarChart3, Download } from 'lucide-react-native';
import { useGetPumpHistory } from '@/api/generated/farmer';
import type { PumpResponse } from '@/api/generated/model';
import { http } from '@/api/http';
import { colors, font, space } from '@/shared/theme';
import { Banner } from '@/shared/ui/Banner';
import { BarChart, Bar } from '@/shared/ui/BarChart';
import { BigActionButton } from '@/shared/ui/BigActionButton';
import { Card, CardTitle } from '@/shared/ui/Card';
import { SegmentedTabs } from '@/shared/ui/SegmentedTabs';
import { StateView } from '@/shared/ui/StateView';
import { formatMinutes } from '@/shared/i18n/format';
import { friendlyError } from '@/shared/i18n/errors';
import { intlLocale } from '@/shared/i18n/languages';
import { shareTextFile } from '@/shared/share';
import { useOnline } from '@/shared/hooks/useOnline';
import { dailyBars, hourlyBars, sumMinutes } from './buckets';

type Period = 'day' | 'week' | 'month';

/** How long the pump ran: hour by hour for today, day by day for a week or a month. */
export const HistoryTab: React.FC<{ pump: PumpResponse }> = ({ pump }) => {
  const { t, i18n } = useTranslation();
  const online = useOnline();
  const lang = i18n.language;
  const [period, setPeriod] = useState<Period>('day');
  const [selected, setSelected] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const q = useGetPumpHistory(pump.id, { period });

  const model = useMemo(() => {
    const records = q.data?.records ?? [];
    const loc = intlLocale(lang);
    if (period === 'day') {
      const bars = hourlyBars(records);
      const rows: Bar[] = bars.map((b, i) => {
        const hour = new Date(b.startMs).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', hour12: false });
        return {
          key: String(b.startMs),
          label: i % 3 === 0 ? hour.slice(0, 2) : '',
          value: b.minutes,
          description: t('history.barDetail', { label: hour, time: formatMinutes(t, b.minutes) }),
        };
      });
      return {
        rows,
        max: 60,
        minutes: sumMinutes(bars),
        starts: null as number | null,
        faults: null as number | null,
        empty: records.length === 0,
      };
    }
    const bars = dailyBars(records);
    const rows: Bar[] = bars.map((b, i) => {
      const date = new Date(`${b.day}T12:00:00`);
      const long = date.toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'short' });
      const label =
        period === 'week'
          ? date.toLocaleDateString(loc, { weekday: 'narrow' })
          : i % 5 === 0
            ? String(date.getDate())
            : '';
      return {
        key: b.day,
        label,
        value: b.minutes,
        description: t('history.barDetail', { label: long, time: formatMinutes(t, b.minutes) }),
      };
    });
    const startsKnown = bars.some((b) => b.starts !== null);
    const faultsKnown = bars.some((b) => b.faults !== null);
    return {
      rows,
      max: Math.max(60, ...bars.map((b) => b.minutes)),
      minutes: sumMinutes(bars),
      starts: startsKnown ? bars.reduce((s, b) => s + (b.starts ?? 0), 0) : null,
      faults: faultsKnown ? bars.reduce((s, b) => s + (b.faults ?? 0), 0) : null,
      empty: bars.length === 0,
    };
  }, [q.data, period, lang, t]);

  const detail = model.rows.find((r) => r.key === selected)?.description;

  const exportCsv = async () => {
    setExporting(true);
    setExportError(false);
    try {
      const res = await http.get<string>(`/pumps/${pump.id}/history.csv`, {
        params: { period },
        responseType: 'text',
        transformResponse: (r) => r,
      });
      await shareTextFile(`pump_${pump.id}_${period}.csv`, res.data, 'text/csv');
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  };

  return (
    <View style={styles.stack}>
      <SegmentedTabs
        options={[
          { key: 'day', label: t('history.day') },
          { key: 'week', label: t('history.week') },
          { key: 'month', label: t('history.month') },
        ]}
        value={period}
        onChange={(p) => {
          setPeriod(p);
          setSelected(null);
        }}
      />

      <Card>
        <CardTitle icon={BarChart3} title={t('history.hoursRun')} />
        {q.isLoading && !q.data ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : q.isError && !q.data ? (
          <StateView
            kind="error"
            title={friendlyError(q.error, t, 'load')}
            actionLabel={t('common.retry')}
            onAction={() => void q.refetch()}
          />
        ) : model.empty ? (
          <View style={styles.center} testID="history-empty">
            <Text style={styles.emptyTitle}>{t('history.empty')}</Text>
            <Text style={styles.emptyHint}>{t('history.emptyHint')}</Text>
          </View>
        ) : (
          <View style={styles.stack}>
            <Text style={styles.caption}>{t(period === 'day' ? 'history.perHour' : 'history.perDay')}</Text>
            <BarChart bars={model.rows} max={model.max} selectedKey={selected} onSelect={setSelected} />
            <Text style={styles.detail} testID="history-detail">
              {detail ?? (model.minutes === 0 ? t('history.noBars') : ' ')}
            </Text>
            <View style={styles.totals}>
              <Text style={styles.totalLabel}>{t('history.total')}</Text>
              <Text style={styles.totalValue}>{formatMinutes(t, model.minutes)}</Text>
              {model.starts !== null ? (
                <Text style={styles.extra}>{t('history.starts', { count: model.starts })}</Text>
              ) : null}
              {model.faults !== null && model.faults > 0 ? (
                <Text style={styles.extra}>{t('history.faultCount', { count: model.faults })}</Text>
              ) : null}
            </View>
            <Text style={styles.caption}>{t('history.estimated')}</Text>
          </View>
        )}
      </Card>

      <View style={styles.stack}>
        {exportError ? <Banner tone="danger" text={t('history.exportFailed')} /> : null}
        <BigActionButton
          testID="history-export"
          icon={Download}
          tone="neutral"
          label={t('history.export')}
          onPress={exportCsv}
          loading={exporting}
          disabled={!online || model.empty}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  stack: { gap: space.md },
  center: { alignItems: 'center', gap: 6, paddingVertical: 24 },
  emptyTitle: { color: colors.text, fontSize: font.title, fontWeight: '800', textAlign: 'center' },
  emptyHint: { color: colors.textMuted, fontSize: font.body, textAlign: 'center', lineHeight: 23 },
  caption: { color: colors.textMuted, fontSize: font.caption + 1, fontWeight: '600' },
  detail: { color: colors.text, fontSize: font.bodyLg, fontWeight: '800', minHeight: 26 },
  totals: { gap: 2, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border },
  totalLabel: { color: colors.textMuted, fontSize: font.body, fontWeight: '700' },
  totalValue: { color: colors.primary, fontSize: 28, fontWeight: '900' },
  extra: { color: colors.textMuted, fontSize: font.body, fontWeight: '700' },
});
