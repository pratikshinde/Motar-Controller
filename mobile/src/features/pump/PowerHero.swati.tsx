import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Calendar, ChevronRight, Clock, Play, RefreshCw, Square, Sun, WifiOff } from 'lucide-react-native';
import type { PumpState } from '@/features/pumps/model';
import { faultName } from '@/shared/i18n/faults';
import { colors } from '@/shared/theme';
import { MotorIcon } from '@/shared/ui/MotorIcon';
import { PumpThumbnail } from '@/shared/ui/PumpThumbnail';
import { formatReading } from '@/shared/i18n/format';
import { driveStatusKey, heroKind } from './swatiHome';

export interface PowerHeroProps {
  name: string;
  hp: number | null | undefined;
  supplyType: string | null | undefined;
  rotation: 'ok' | 'wrong' | null;
  state: PumpState;
  signalDbm: number | null | undefined;
  busy: boolean;
  disabled: boolean;
  cooldownLeft: number;
  /** Swati design only (the classic hero ignores these). */
  isSolar?: boolean;
  solarKw?: number | null;
  faultCode?: number | null;
  /** The command being carried out right now, if any. */
  pending?: 'START' | 'STOP' | null;
  lastUpdatedText?: string;
  runtimeTodayText?: string;
  timerText?: string;
  /** The solar drive's readings (Swati solar pumps): shown as a card of their own under the two tiles. */
  solar?: { hz?: number | null; iOut?: number | null; vAc?: number | null; vDc?: number | null; kw?: number | null; status?: string | null } | null;
  onOpenTechnical?: () => void;
  onPower: () => void;
  onRetry?: () => void;
  onSelectPump?: () => void;
  onOpenTimer?: () => void;
  onOpenHistory?: () => void;
}

const kwText = (kw: number): string => (Math.round(kw * 10) / 10).toFixed(1);

export const PowerHeroSwati: React.FC<PowerHeroProps> = ({
  name,
  hp,
  state,
  disabled,
  cooldownLeft,
  isSolar = false,
  solarKw,
  faultCode,
  pending = null,
  lastUpdatedText,
  runtimeTodayText,
  timerText,
  solar,
  onOpenTechnical,
  onPower,
  onRetry,
  onSelectPump,
  onOpenTimer,
  onOpenHistory,
}) => {
  const { t } = useTranslation();
  const kind = heroKind({ state, pending, isSolar, faultCode });
  const pumpOn = kind === 'running';
  const lastSeen = lastUpdatedText ?? '';
  const spec = [isSolar ? t('swati.typeSolar') : t('swati.type3Phase'), hp ? t('pumps.hp', { hp }) : null]
    .filter(Boolean)
    .join(' • ');
  const retry = onRetry ?? onPower;
  const cause = faultCode ? t(`faultInfo.code${faultCode}.cause`, { defaultValue: t('faultInfo.unknown.cause') }) : t('faultInfo.unknown.cause');
  const action = faultCode ? t(`faultInfo.code${faultCode}.action`, { defaultValue: t('faultInfo.unknown.action') }) : t('faultInfo.unknown.action');

  const retryButton = (label: string) => (
    <TouchableOpacity testID="power-button" style={styles.retryButton} onPress={retry} activeOpacity={0.85} accessibilityRole="button">
      <RefreshCw size={18} color={colors.primary} />
      <Text style={styles.retryButtonText}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* The pump (tap to switch between the farmer's pumps) */}
      <TouchableOpacity
        style={styles.deviceCard}
        onPress={onSelectPump}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={t('pumps.title')}
      >
        <PumpThumbnail type={isSolar ? 'SOLAR_VFD' : '3PHASE'} size={46} />
        <View style={styles.deviceInfo}>
          <Text style={styles.deviceName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.deviceSpec}>{spec}</Text>
        </View>
        <ChevronRight size={22} color="#64748B" />
      </TouchableOpacity>

      {kind === 'problem' ? (
        <View style={styles.alertCardRed}>
          <View style={styles.alertIconWrapRed}>
            <AlertTriangle size={32} color={colors.danger} />
          </View>
          <Text style={styles.alertTitleRed}>{faultCode ? faultName(t, faultCode) : t('faults.unknown', { code: '?' })}</Text>
          <View style={styles.checklist}>
            <Text style={styles.checkHeading}>{t('swati.whatToDo')}</Text>
            <Text style={styles.checkItem}>{cause}</Text>
            <Text style={styles.checkItem}>{action}</Text>
          </View>
          {retryButton(t('common.checkAgain'))}
        </View>
      ) : kind === 'sunlight' ? (
        <View style={styles.alertCardSun}>
          <View style={styles.alertIconWrapAmber}>
            <Sun size={32} color={colors.warn} />
          </View>
          <Text style={styles.alertTitleAmber}>{t('swati.sunTitle')}</Text>
          <Text style={styles.alertSubtitleAmber}>{t('swati.sunBody')}</Text>
          {lastSeen ? <Text style={styles.alertTimeAmber}>{t('swati.lastUpdated', { when: lastSeen })}</Text> : null}
        </View>
      ) : kind === 'offline' || kind === 'nodata' ? (
        <View style={styles.alertCardAmber}>
          <View style={styles.alertIconWrapAmber}>
            <WifiOff size={32} color={colors.warn} />
          </View>
          <Text style={styles.alertTitleAmber}>{kind === 'nodata' ? t('swati.noReadingsTitle') : t('swati.offlineTitle')}</Text>
          <Text style={styles.alertSubtitleAmber}>{kind === 'nodata' ? t('swati.noReadingsBody') : t('swati.offlineBody')}</Text>
          {lastSeen ? <Text style={styles.alertTimeAmber}>{t('swati.lastUpdated', { when: lastSeen })}</Text> : null}
          {retryButton(t('common.retry'))}
        </View>
      ) : kind === 'starting' || kind === 'stopping' ? (
        <View style={styles.centerSection}>
          <View style={styles.outerRingBlue}>
            <View style={styles.innerCircleBlue}>
              <MotorIcon size={64} color={colors.primary} />
            </View>
          </View>
          <Text style={styles.statusTextBlue}>{kind === 'starting' ? t('swati.starting') : t('swati.stopping')}</Text>
          <Text style={styles.cooldownNotice}>{t('swati.pleaseWait')}</Text>
          <TouchableOpacity testID="power-button" style={[styles.mainActionButton, styles.btnBlueDisabled]} disabled>
            <ActivityIndicator size="small" color="#FFFFFF" style={{ marginEnd: 8 }} />
            <Text style={styles.btnText}>{kind === 'starting' ? t('swati.starting') : t('swati.stopping')}</Text>
          </TouchableOpacity>
          {cooldownLeft > 0 ? <Text style={styles.cooldownNotice}>{t('swati.nextCommandIn', { seconds: cooldownLeft })}</Text> : null}
        </View>
      ) : (
        <View style={styles.centerSection}>
          <View style={[styles.outerRing, pumpOn ? styles.outerRingGreen : styles.outerRingGrey]}>
            <View style={[styles.innerCircle, pumpOn ? styles.innerCircleGreen : styles.innerCircleGrey]}>
              <MotorIcon size={68} color={pumpOn ? '#FFFFFF' : '#64748B'} />
            </View>
          </View>

          <Text style={[styles.statusText, pumpOn ? styles.statusGreen : styles.statusGrey]}>
            {pumpOn ? t('swati.pumpIsRunning') : t('swati.pumpIsOff')}
          </Text>

          {pumpOn && isSolar && solarKw != null ? (
            <View style={styles.solarBadge}>
              <Sun size={16} color="#B45309" />
              <Text style={styles.solarBadgeText}>{t('swati.solarPower', { kw: kwText(solarKw) })}</Text>
            </View>
          ) : null}

          {lastSeen ? <Text style={styles.lastUpdatedText}>{t('swati.lastUpdated', { when: lastSeen })}</Text> : null}

          <TouchableOpacity
            testID="power-button"
            style={[styles.mainActionButton, pumpOn ? styles.btnRed : styles.btnGreen, disabled && { opacity: 0.6 }]}
            onPress={onPower}
            disabled={disabled}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            {pumpOn ? (
              <Square size={20} color="#FFFFFF" fill="#FFFFFF" style={{ marginEnd: 8 }} />
            ) : (
              <Play size={20} color="#FFFFFF" fill="#FFFFFF" style={{ marginEnd: 8 }} />
            )}
            <Text style={styles.btnText}>{pumpOn ? t('swati.stopPump') : t('swati.startPump')}</Text>
          </TouchableOpacity>
          {cooldownLeft > 0 ? <Text style={styles.cooldownNotice}>{t('swati.nextCommandIn', { seconds: cooldownLeft })}</Text> : null}
        </View>
      )}

      <View style={styles.bottomStatsRow}>
        <TouchableOpacity style={styles.statCard} onPress={onOpenHistory} activeOpacity={0.8} accessibilityRole="button">
          <View style={styles.statIconBoxBlue}>
            <Clock size={20} color={colors.primary} />
          </View>
          <View style={styles.statContent}>
            <Text style={styles.statLabel}>{t('swati.runtimeToday')}</Text>
            <Text style={styles.statValue}>{runtimeTodayText ?? '—'}</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.statCard} onPress={onOpenTimer} activeOpacity={0.8} accessibilityRole="button">
          <View style={styles.statIconBoxPurple}>
            <Calendar size={20} color="#7C3AED" />
          </View>
          <View style={styles.statContent}>
            <Text style={styles.statLabel}>{t('swati.timerTile')}</Text>
            <Text style={styles.statValue}>{timerText ?? t('swati.timerNone')}</Text>
          </View>
        </TouchableOpacity>
      </View>

      {isSolar && solar ? (
        <TouchableOpacity style={styles.solarCard} onPress={onOpenTechnical} activeOpacity={0.85} accessibilityRole="button">
          <Text style={styles.solarTitle}>{t('swati.technical')}</Text>
          <View style={styles.solarGrid}>
            {[
              [t('swati.frequency'), formatReading(solar.hz, 1), 'Hz'],
              [t('swati.outputCurrent'), formatReading(solar.iOut, 1), 'A'],
              [t('swati.outputVoltage'), formatReading(solar.vAc, 0), 'V'],
              [t('swati.dcVoltage'), formatReading(solar.vDc, 0), 'V'],
              [t('swati.power'), formatReading(solar.kw, 1), 'kW'],
              [t('swati.driveStatus'), driveStatusKey(solar.status) ? t(driveStatusKey(solar.status) as string) : (solar.status ?? '—'), ''],
            ].map(([label, value, unit]) => (
              <View key={label} style={styles.solarCell}>
                <Text style={styles.solarLabel} numberOfLines={2}>
                  {label}
                </Text>
                <Text style={styles.solarValue}>
                  {value}
                  {unit && value !== '—' ? ` ${unit}` : ''}
                </Text>
              </View>
            ))}
          </View>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  deviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    padding: 10,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  deviceInfo: {
    flex: 1,
    marginStart: 12,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  deviceSpec: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 2,
  },
  centerSection: {
    alignItems: 'center',
    marginVertical: 8,
  },
  outerRing: {
    width: 176,
    height: 176,
    borderRadius: 88,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  outerRingGreen: {
    backgroundColor: '#DCFCE7',
    borderWidth: 3,
    borderColor: '#86EFAC',
  },
  outerRingGrey: {
    backgroundColor: '#F1F5F9',
    borderWidth: 3,
    borderColor: '#E2E8F0',
  },
  innerCircle: {
    width: 148,
    height: 148,
    borderRadius: 74,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerCircleGreen: {
    backgroundColor: '#16A34A',
  },
  innerCircleGrey: {
    backgroundColor: '#F8FAFC',
    borderWidth: 2,
    borderColor: '#CBD5E1',
  },
  outerRingBlue: {
    width: 176,
    height: 176,
    borderRadius: 88,
    backgroundColor: '#E0F2FE',
    borderWidth: 3,
    borderColor: '#7DD3FC',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  innerCircleBlue: {
    width: 148,
    height: 148,
    borderRadius: 74,
    backgroundColor: '#BAE6FD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: {
    fontSize: 20,
    fontWeight: '900',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  statusGreen: {
    color: '#15803D',
  },
  statusGrey: {
    color: '#0F172A',
  },
  statusTextBlue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0369A1',
    textAlign: 'center',
    marginBottom: 14,
    paddingHorizontal: 20,
  },
  solarBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEF3C7',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
    marginBottom: 6,
  },
  solarBadgeText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#B45309',
  },
  lastUpdatedText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 20,
  },
  mainActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 14,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  btnGreen: {
    backgroundColor: '#16A34A',
  },
  btnRed: {
    backgroundColor: '#DC2626',
  },
  btnBlueDisabled: {
    backgroundColor: '#0284C7',
    opacity: 0.85,
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cooldownNotice: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748B',
    marginTop: 12,
    textAlign: 'center',
  },
  alertCardRed: {
    backgroundColor: '#FEF2F2',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
    padding: 18,
    alignItems: 'center',
    marginVertical: 12,
  },
  alertIconWrapRed: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  alertTitleRed: {
    fontSize: 16,
    fontWeight: '800',
    color: '#991B1B',
    textAlign: 'center',
    marginBottom: 12,
  },
  checklist: {
    alignSelf: 'stretch',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  solarCard: {
    marginTop: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    padding: 14,
  },
  solarTitle: { fontSize: 15, fontWeight: '800', color: '#0F172A', marginBottom: 8 },
  solarGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 },
  solarCell: { width: '50%', paddingEnd: 8 },
  solarLabel: { fontSize: 14, fontWeight: '700', color: '#64748B' },
  solarValue: { fontSize: 18, fontWeight: '800', color: '#0F172A', marginTop: 2, fontVariant: ['tabular-nums'] },
  checkHeading: {
    fontSize: 15,
    fontWeight: '900',
    color: '#7F1D1D',
    marginBottom: 4,
  },
  alertCardSun: {
    backgroundColor: '#FFFBEB',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#FDE68A',
    padding: 18,
    alignItems: 'center',
    marginVertical: 12,
  },
  checkItem: {
    fontSize: 14,
    fontWeight: '700',
    color: '#7F1D1D',
    marginVertical: 3,
  },
  alertCardAmber: {
    backgroundColor: '#FFFBEB',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#FDE68A',
    padding: 18,
    alignItems: 'center',
    marginVertical: 12,
  },
  alertIconWrapAmber: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  alertTitleAmber: {
    fontSize: 17,
    fontWeight: '800',
    color: '#92400E',
    textAlign: 'center',
    marginBottom: 6,
  },
  alertSubtitleAmber: {
    fontSize: 14,
    fontWeight: '700',
    color: '#78350F',
    marginBottom: 4,
  },
  alertTimeAmber: {
    fontSize: 14,
    fontWeight: '600',
    color: '#A16207',
    marginBottom: 16,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#E0F2FE',
    borderWidth: 1.5,
    borderColor: '#0284C7',
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  retryButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0284C7',
  },
  bottomStatsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  statCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  statIconBoxBlue: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#E0F2FE',
    alignItems: 'center',
    justifyContent: 'center',
    marginEnd: 10,
  },
  statIconBoxPurple: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#EDE9FE',
    alignItems: 'center',
    justifyContent: 'center',
    marginEnd: 10,
  },
  statContent: {
    flex: 1,
  },
  statLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748B',
  },
  statValue: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
});
