import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, WifiOff } from 'lucide-react-native';
import { useGetPump } from '@/api/generated/farmer';
import { colors } from '@/shared/theme';
import { StateView } from '@/shared/ui/StateView';
import { SwatiPage } from '@/shared/ui/SwatiPage';
import { faultName } from '@/shared/i18n/faults';
import { formatReading, timeAgo } from '@/shared/i18n/format';
import { useNow } from '@/shared/hooks/useOnline';
import { useCurrentPump } from '@/features/pumps/useCurrentPump';
import { pumpState } from '@/features/pumps/model';
import { driveStatusKey } from './swatiHome';

interface Row {
  label: string;
  value: number | null | undefined;
  unit: string;
  digits: number;
  dot?: string;
}

const Rows: React.FC<{ rows: Row[]; footerLabel?: string; footerValue?: string }> = ({ rows, footerLabel, footerValue }) => (
  <View style={styles.card}>
    {rows.map((r, i) => (
      <View key={r.label}>
        {i > 0 ? <View style={styles.divider} /> : null}
        <View style={styles.metricRow}>
          <View style={styles.labelRow}>
            {r.dot ? <View style={[styles.dot, { backgroundColor: r.dot }]} /> : null}
            <Text style={styles.metricLabel}>{r.label}</Text>
          </View>
          {/* A value the pump has not reported is a dash, never a made-up number. */}
          <Text style={styles.metricValue}>
            {formatReading(r.value, r.digits)}
            {r.value != null ? ` ${r.unit}` : ''}
          </Text>
        </View>
      </View>
    ))}
    {footerLabel ? (
      <View>
        <View style={styles.divider} />
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>{footerLabel}</Text>
          <Text style={styles.metricValue}>{footerValue}</Text>
        </View>
      </View>
    ) : null}
  </View>
);

/** Technical details of the current pump: the mains (3-phase) readings, or the solar drive's, following the pump's own type. */
export const TechnicalScreen: React.FC = () => {
  const { t } = useTranslation();
  const now = useNow(30_000);
  const { pump: summary, loading } = useCurrentPump();
  const detail = useGetPump(summary?.id ?? '', { query: { enabled: !!summary, refetchInterval: 15_000 } });
  const pump = detail.data?.pump ?? summary;

  const isSolar = pump?.device_type === 'SOLAR_VFD';
  const state = pump ? pumpState(pump, now) : 'nodata';

  return (
    <SwatiPage title={t('swati.technical')}>
      {loading || !pump ? (
        <StateView kind={loading ? 'loading' : 'empty'} title={loading ? t('common.loading') : t('pumps.emptyTitle')} />
      ) : (
        <>
          {isSolar ? (
            <Rows
              rows={[
                { label: t('swati.frequency'), value: pump.vfd_hz, unit: 'Hz', digits: 1 },
                { label: t('swati.outputCurrent'), value: pump.vfd_i_out, unit: 'A', digits: 1 },
                { label: t('swati.outputVoltage'), value: pump.vfd_v_ac, unit: 'V', digits: 0 },
                { label: t('swati.dcVoltage'), value: pump.vfd_v_dc, unit: 'V', digits: 0 },
                { label: t('swati.power'), value: pump.vfd_kw, unit: 'kW', digits: 1 },
              ]}
              footerLabel={t('swati.driveStatus')}
              footerValue={driveStatusKey(pump.vfd_status) ? t(driveStatusKey(pump.vfd_status) as string) : (pump.vfd_status ?? '—')}
            />
          ) : (
            <>
              <Text style={styles.section}>{t('dashboard.cardVoltages')}</Text>
              <Rows
                rows={[
                  { label: 'R - Y', value: pump.v_ry, unit: 'V', digits: 0, dot: '#EF4444' },
                  { label: 'Y - B', value: pump.v_yb, unit: 'V', digits: 0, dot: '#F59E0B' },
                  { label: 'B - R', value: pump.v_br, unit: 'V', digits: 0, dot: '#3B82F6' },
                ]}
              />
              <Text style={styles.section}>{t('dashboard.cardCurrents')}</Text>
              <Rows
                rows={[
                  { label: 'R', value: pump.i_r, unit: 'A', digits: 1, dot: '#EF4444' },
                  { label: 'Y', value: pump.i_y, unit: 'A', digits: 1, dot: '#F59E0B' },
                  { label: 'B', value: pump.i_b, unit: 'A', digits: 1, dot: '#3B82F6' },
                ]}
              />
            </>
          )}

          {state === 'fault' ? (
            <View style={[styles.statusCard, styles.statusBad]}>
              <View style={styles.statusRow}>
                <AlertTriangle size={24} color={colors.danger} />
                <Text style={[styles.statusTitle, { color: colors.danger }]}>
                  {pump.fault_code ? faultName(t, pump.fault_code) : t('swati.problemNow')}
                </Text>
              </View>
              <Text style={styles.statusSub}>{t('swati.lastUpdated', { when: timeAgo(t, pump.last_seen_at, now) })}</Text>
            </View>
          ) : state === 'offline' || state === 'nodata' ? (
            <View style={[styles.statusCard, styles.statusWarn]}>
              <View style={styles.statusRow}>
                <WifiOff size={24} color={colors.warn} />
                <Text style={[styles.statusTitle, { color: '#92400E' }]}>
                  {state === 'nodata' ? t('swati.noReadingsTitle') : t('swati.offlineTitle')}
                </Text>
              </View>
              {pump.last_seen_at ? (
                <Text style={styles.statusSub}>{t('swati.lastUpdated', { when: timeAgo(t, pump.last_seen_at, now) })}</Text>
              ) : null}
            </View>
          ) : (
            <View style={[styles.statusCard, styles.statusGood]}>
              <View style={styles.statusRow}>
                <CheckCircle2 size={24} color="#16A34A" />
                <Text style={[styles.statusTitle, { color: '#15803D' }]}>{t('swati.allOk')}</Text>
              </View>
              <Text style={styles.statusSub}>{t('swati.lastUpdated', { when: timeAgo(t, pump.last_seen_at, now) })}</Text>
            </View>
          )}
        </>
      )}
    </SwatiPage>
  );
};

const styles = StyleSheet.create({
  section: { fontSize: 16, fontWeight: '800', color: '#0F172A', marginBottom: -4 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  metricRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, gap: 12 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  metricLabel: { fontSize: 16, fontWeight: '700', color: '#334155', flexShrink: 1 },
  metricValue: { fontSize: 17, fontWeight: '800', color: '#0F172A', fontVariant: ['tabular-nums'] },
  divider: { height: 1, backgroundColor: '#F1F5F9' },
  statusCard: { borderRadius: 16, borderWidth: 1.5, padding: 16, gap: 4 },
  statusGood: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
  statusWarn: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  statusBad: { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusTitle: { fontSize: 17, fontWeight: '800', flexShrink: 1 },
  statusSub: { fontSize: 14, fontWeight: '600', color: '#475569', marginStart: 34 },
});
