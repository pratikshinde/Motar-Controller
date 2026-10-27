import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Sun,
  WifiOff,
  Zap,
} from 'lucide-react-native';
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

interface MetricItem {
  label: string;
  value: number | null | undefined;
  unit: string;
  digits: number;
  dot?: string;
  subtitle?: string;
  barRatio?: number;
}

const EngineeringCard: React.FC<{
  title: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  accentColor: string;
  metrics: MetricItem[];
  footerLabel?: string;
  footerValue?: string;
}> = ({ title, icon: Icon, accentColor, metrics, footerLabel, footerValue }) => (
  <View style={styles.card}>
    <View style={styles.cardHeader}>
      <View style={[styles.headerIconBox, { backgroundColor: `${accentColor}18` }]}>
        <Icon size={18} color={accentColor} />
      </View>
      <Text style={styles.cardTitle}>{title}</Text>
    </View>

    <View style={styles.metricsList}>
      {metrics.map((m, idx) => (
        <View key={m.label} style={styles.metricItem}>
          {idx > 0 && <View style={styles.divider} />}
          <View style={styles.metricRow}>
            <View style={styles.labelCol}>
              <View style={styles.labelRow}>
                {m.dot ? <View style={[styles.dot, { backgroundColor: m.dot }]} /> : null}
                <Text style={styles.metricLabel}>{m.label}</Text>
              </View>
              {m.subtitle ? <Text style={styles.metricSub}>{m.subtitle}</Text> : null}
            </View>

            <View style={styles.valueCol}>
              <Text style={styles.metricValue}>
                {formatReading(m.value, m.digits)}
                {m.value != null ? <Text style={styles.metricUnit}> {m.unit}</Text> : ''}
              </Text>
            </View>
          </View>

          {m.barRatio !== undefined && m.value != null ? (
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barFill,
                  { width: `${Math.round(m.barRatio * 100)}%`, backgroundColor: accentColor },
                ]}
              />
            </View>
          ) : null}
        </View>
      ))}

      {footerLabel ? (
        <View style={styles.footerRowWrap}>
          <View style={styles.divider} />
          <View style={styles.metricRow}>
            <Text style={styles.footerLabel}>{footerLabel}</Text>
            <View style={styles.statusPill}>
              <Text style={styles.statusPillText}>{footerValue}</Text>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  </View>
);

export const TechnicalScreen: React.FC = () => {
  const { t } = useTranslation();
  const now = useNow(30_000);
  const { pump: summary, loading } = useCurrentPump();
  const detail = useGetPump(summary?.id ?? '', {
    query: { enabled: !!summary, refetchInterval: 15_000 },
  });
  const pump = detail.data?.pump ?? summary;

  const isSolar = pump?.device_type === 'SOLAR_VFD';
  const state = pump ? pumpState(pump, now) : 'nodata';

  return (
    <SwatiPage title={t('swati.technical')}>
      {loading || !pump ? (
        <StateView
          kind={loading ? 'loading' : 'empty'}
          title={loading ? t('common.loading') : t('pumps.emptyTitle')}
        />
      ) : (
        <>
          {/* Header Summary Banner */}
          <View style={styles.summaryBanner}>
            <View style={styles.summaryLeft}>
              <Text style={styles.summaryTitle}>{pump.name}</Text>
              <Text style={styles.summarySub}>
                ID: {pump.id} {pump.hp_rating ? `• ${pump.hp_rating} HP` : ''}
              </Text>
            </View>
            <View style={[styles.typeTag, isSolar ? styles.typeTagSolar : styles.typeTagGrid]}>
              <Text style={[styles.typeTagText, isSolar ? styles.typeTagTextSolar : styles.typeTagTextGrid]}>
                {isSolar ? 'SOLAR VFD' : '3-PHASE GRID'}
              </Text>
            </View>
          </View>

          {isSolar ? (
            <>
              {/* 1. Solar Photovoltaic & DC Bus */}
              <EngineeringCard
                title="Solar Array & DC Bus Link"
                icon={Sun}
                accentColor="#D97706"
                metrics={[
                  {
                    label: t('swati.dcVoltage'),
                    value: pump.vfd_v_dc,
                    unit: 'V DC',
                    digits: 0,
                    subtitle:
                      pump.vfd_v_dc != null
                        ? pump.vfd_v_dc > 450
                          ? 'Optimal solar MPPT range'
                          : 'Low solar irradiance'
                        : undefined,
                  },
                ]}
              />

              {/* 2. Inverter & Motor Output */}
              <EngineeringCard
                title="Drive Output & Motor Telemetry"
                icon={Zap}
                accentColor="#0284C7"
                metrics={[
                  {
                    label: t('swati.frequency'),
                    value: pump.vfd_hz,
                    unit: 'Hz',
                    digits: 1,
                    subtitle: 'Fuji FRENIC-Ace Output (0–50 Hz)',
                    barRatio: pump.vfd_hz != null ? Math.min(Math.max(pump.vfd_hz / 50, 0), 1) : 0,
                  },
                  {
                    label: t('swati.power'),
                    value: pump.vfd_kw,
                    unit: 'kW',
                    digits: 1,
                    subtitle: 'Instantaneous Motor Shaft Power',
                  },
                  {
                    label: t('swati.outputCurrent'),
                    value: pump.vfd_i_out,
                    unit: 'A',
                    digits: 1,
                    subtitle: 'Motor Output Current Draw',
                  },
                  {
                    label: t('swati.outputVoltage'),
                    value: pump.vfd_v_ac,
                    unit: 'V AC',
                    digits: 0,
                    subtitle: 'Synthesized 3-Phase AC Output',
                  },
                ]}
              />

              {/* 3. Fuji Drive Controller Status */}
              <EngineeringCard
                title="Fuji FRENIC-Ace Drive Diagnostics"
                icon={Cpu}
                accentColor="#7C3AED"
                metrics={[]}
                footerLabel={t('swati.driveStatus')}
                footerValue={
                  driveStatusKey(pump.vfd_status)
                    ? (t(driveStatusKey(pump.vfd_status) as string) as string)
                    : pump.vfd_status ?? '—'
                }
              />
            </>
          ) : (
            <>
              {/* 3-Phase Grid AC Voltages */}
              <EngineeringCard
                title={t('dashboard.cardVoltages')}
                icon={Zap}
                accentColor="#0284C7"
                metrics={[
                  { label: 'R - Y Phase', value: pump.v_ry, unit: 'V', digits: 0, dot: '#EF4444' },
                  { label: 'Y - B Phase', value: pump.v_yb, unit: 'V', digits: 0, dot: '#F59E0B' },
                  { label: 'B - R Phase', value: pump.v_br, unit: 'V', digits: 0, dot: '#3B82F6' },
                ]}
              />

              {/* 3-Phase Grid AC Currents */}
              <EngineeringCard
                title={t('dashboard.cardCurrents')}
                icon={Activity}
                accentColor="#16A34A"
                metrics={[
                  { label: 'Phase R Current', value: pump.i_r, unit: 'A', digits: 1, dot: '#EF4444' },
                  { label: 'Phase Y Current', value: pump.i_y, unit: 'A', digits: 1, dot: '#F59E0B' },
                  { label: 'Phase B Current', value: pump.i_b, unit: 'A', digits: 1, dot: '#3B82F6' },
                ]}
              />
            </>
          )}

          {/* System Health / Diagnostic Footer Card */}
          {state === 'fault' ? (
            <View style={[styles.statusCard, styles.statusBad]}>
              <View style={styles.statusRow}>
                <View style={styles.statusIconWrapBad}>
                  <AlertTriangle size={24} color={colors.danger} />
                </View>
                <View style={styles.statusTextWrap}>
                  <Text style={[styles.statusTitle, { color: colors.danger }]}>
                    {pump.fault_code ? faultName(t, pump.fault_code) : t('swati.problemNow')}
                  </Text>
                  <Text style={styles.statusSub}>
                    {t('swati.lastUpdated', { when: timeAgo(t, pump.last_seen_at, now) })}
                  </Text>
                </View>
              </View>
            </View>
          ) : state === 'offline' || state === 'nodata' ? (
            <View style={[styles.statusCard, styles.statusWarn]}>
              <View style={styles.statusRow}>
                <View style={styles.statusIconWrapWarn}>
                  <WifiOff size={24} color="#D97706" />
                </View>
                <View style={styles.statusTextWrap}>
                  <Text style={[styles.statusTitle, { color: '#92400E' }]}>
                    {state === 'nodata' ? t('swati.noReadingsTitle') : t('swati.offlineTitle')}
                  </Text>
                  {pump.last_seen_at ? (
                    <Text style={styles.statusSub}>
                      {t('swati.lastUpdated', { when: timeAgo(t, pump.last_seen_at, now) })}
                    </Text>
                  ) : null}
                </View>
              </View>
            </View>
          ) : (
            <View style={[styles.statusCard, styles.statusGood]}>
              <View style={styles.statusRow}>
                <View style={styles.statusIconWrapGood}>
                  <CheckCircle2 size={24} color="#16A34A" />
                </View>
                <View style={styles.statusTextWrap}>
                  <Text style={[styles.statusTitle, { color: '#15803D' }]}>{t('swati.allOk')}</Text>
                  <Text style={styles.statusSub}>
                    {t('swati.lastUpdated', { when: timeAgo(t, pump.last_seen_at, now) })}
                  </Text>
                </View>
              </View>
            </View>
          )}
        </>
      )}
    </SwatiPage>
  );
};

const styles = StyleSheet.create({
  summaryBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    padding: 14,
    marginBottom: 4,
    shadowColor: '#0F172A',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  summaryLeft: {
    flex: 1,
  },
  summaryTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  summarySub: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 2,
  },
  typeTag: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  typeTagSolar: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  typeTagGrid: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  typeTagText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  typeTagTextSolar: {
    color: '#B45309',
  },
  typeTagTextGrid: {
    color: '#1D4ED8',
  },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    padding: 16,
    shadowColor: '#0F172A',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerIconBox: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  metricsList: {
    gap: 10,
  },
  metricItem: {
    gap: 6,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    gap: 12,
  },
  labelCol: {
    flex: 1,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  metricLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#334155',
  },
  metricSub: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 2,
  },
  valueCol: {
    alignItems: 'flex-end',
  },
  metricValue: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0F172A',
    fontVariant: ['tabular-nums'],
  },
  metricUnit: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  barTrack: {
    height: 5,
    backgroundColor: '#F1F5F9',
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 2,
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 4,
  },
  footerRowWrap: {
    marginTop: 4,
  },
  footerLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748B',
  },
  statusPill: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusPillText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#15803D',
  },

  /* Diagnostics Card */
  statusCard: {
    borderRadius: 18,
    borderWidth: 1.5,
    padding: 16,
  },
  statusGood: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  statusWarn: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  statusBad: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statusIconWrapGood: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusIconWrapWarn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusIconWrapBad: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTextWrap: {
    flex: 1,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  statusSub: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 2,
  },
});
