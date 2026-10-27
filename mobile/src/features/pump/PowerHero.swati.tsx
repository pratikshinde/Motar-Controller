import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  ChevronRight,
  Clock,
  Play,
  RefreshCw,
  Square,
  Sun,
  WifiOff,
  Zap,
} from 'lucide-react-native';
import type { PumpState } from '@/features/pumps/model';
import { faultName } from '@/shared/i18n/faults';
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
  solar?: {
    hz?: number | null;
    iOut?: number | null;
    vAc?: number | null;
    vDc?: number | null;
    kw?: number | null;
    status?: string | null;
  } | null;
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
  const cause = faultCode
    ? t(`faultInfo.code${faultCode}.cause`, { defaultValue: t('faultInfo.unknown.cause') })
    : t('faultInfo.unknown.cause');
  const action = faultCode
    ? t(`faultInfo.code${faultCode}.action`, { defaultValue: t('faultInfo.unknown.action') })
    : t('faultInfo.unknown.action');

  const retryButton = (label: string) => (
    <TouchableOpacity
      testID="power-button"
      style={styles.retryButton}
      onPress={retry}
      activeOpacity={0.85}
      accessibilityRole="button"
    >
      <RefreshCw size={18} color="#0284C7" />
      <Text style={styles.retryButtonText}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* 1. Header Pump Switcher Card */}
      <TouchableOpacity
        style={styles.deviceCard}
        onPress={onSelectPump}
        activeOpacity={0.82}
        accessibilityRole="button"
        accessibilityLabel={`${name} • ${spec}`}
      >
        <View style={styles.thumbWrap}>
          <PumpThumbnail type={isSolar ? 'SOLAR_VFD' : '3PHASE'} size={48} />
          {pumpOn && <View style={styles.onlineBadgeDot} />}
        </View>

        <View style={styles.deviceInfo}>
          <View style={styles.deviceHeaderRow}>
            <Text style={styles.deviceName} numberOfLines={1}>
              {name}
            </Text>
          </View>
          <View style={styles.badgesRow}>
            <View style={[styles.typeBadge, isSolar ? styles.typeBadgeSolar : styles.typeBadgeGrid]}>
              {isSolar && <Sun size={11} color="#B45309" style={{ marginRight: 3 }} />}
              <Text style={[styles.typeBadgeText, isSolar ? styles.typeBadgeTextSolar : styles.typeBadgeTextGrid]}>
                {isSolar ? t('swati.typeSolar') : t('swati.type3Phase')}
              </Text>
            </View>
            {hp ? (
              <View style={styles.hpBadge}>
                <Text style={styles.hpBadgeText}>{t('pumps.hp', { hp })}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.switchPromptWrap}>
          <Text style={styles.switchPromptText}>{t('pumps.title')}</Text>
          <ChevronRight size={18} color="#64748B" />
        </View>
      </TouchableOpacity>

      {/* 2. Hero Centerpiece States */}
      {kind === 'problem' ? (
        <View style={styles.alertCardRed}>
          <View style={styles.alertHeaderRow}>
            <View style={styles.alertIconWrapRed}>
              <AlertTriangle size={28} color="#DC2626" />
            </View>
            <View style={styles.alertTitleWrap}>
              <Text style={styles.alertBadgeRed}>
                {faultCode ? `FAULT CODE #${faultCode}` : 'MOTOR TRIP ALERT'}
              </Text>
              <Text style={styles.alertTitleRed}>
                {faultCode ? faultName(t, faultCode) : t('faults.unknown', { code: '?' })}
              </Text>
            </View>
          </View>

          <View style={styles.checklist}>
            <Text style={styles.checkHeading}>{t('swati.whatToDo')}</Text>
            <View style={styles.checkItemRow}>
              <View style={styles.bulletRed} />
              <Text style={styles.checkItem}>{cause}</Text>
            </View>
            <View style={styles.checkItemRow}>
              <View style={styles.bulletRed} />
              <Text style={styles.checkItem}>{action}</Text>
            </View>
          </View>

          {retryButton(t('common.checkAgain'))}
        </View>
      ) : kind === 'sunlight' ? (
        <View style={styles.alertCardSun}>
          <View style={styles.alertIconWrapAmber}>
            <Sun size={34} color="#D97706" />
          </View>
          <View style={styles.solarStandbyPill}>
            <Text style={styles.solarStandbyPillText}>SOLAR PV STANDBY</Text>
          </View>
          <Text style={styles.alertTitleAmber}>{t('swati.sunTitle')}</Text>
          <Text style={styles.alertSubtitleAmber}>{t('swati.sunBody')}</Text>
          {lastSeen ? (
            <Text style={styles.alertTimeAmber}>{t('swati.lastUpdated', { when: lastSeen })}</Text>
          ) : null}
        </View>
      ) : kind === 'offline' || kind === 'nodata' ? (
        <View style={styles.alertCardAmber}>
          <View style={styles.alertIconWrapAmber}>
            <WifiOff size={32} color="#D97706" />
          </View>
          <Text style={styles.alertTitleAmber}>
            {kind === 'nodata' ? t('swati.noReadingsTitle') : t('swati.offlineTitle')}
          </Text>
          <Text style={styles.alertSubtitleAmber}>
            {kind === 'nodata' ? t('swati.noReadingsBody') : t('swati.offlineBody')}
          </Text>
          {lastSeen ? (
            <Text style={styles.alertTimeAmber}>{t('swati.lastUpdated', { when: lastSeen })}</Text>
          ) : null}
          {retryButton(t('common.retry'))}
        </View>
      ) : kind === 'starting' || kind === 'stopping' ? (
        <View style={styles.centerSection}>
          <View style={styles.outerRingBlue}>
            <View style={styles.innerCircleBlue}>
              <MotorIcon size={66} color="#0284C7" />
            </View>
          </View>
          <Text style={styles.statusTextBlue}>
            {kind === 'starting' ? t('swati.starting') : t('swati.stopping')}
          </Text>
          <Text style={styles.cooldownNotice}>{t('swati.pleaseWait')}</Text>
          <TouchableOpacity
            testID="power-button"
            style={[styles.mainActionButton, styles.btnBlueDisabled]}
            disabled
          >
            <ActivityIndicator size="small" color="#FFFFFF" style={{ marginEnd: 10 }} />
            <Text style={styles.btnText}>
              {kind === 'starting' ? t('swati.starting') : t('swati.stopping')}
            </Text>
          </TouchableOpacity>
          {cooldownLeft > 0 ? (
            <Text style={styles.cooldownNotice}>
              {t('swati.nextCommandIn', { seconds: cooldownLeft })}
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={styles.centerSection}>
          {/* Main Visual Motor Halo */}
          <View style={[styles.outerHalo, pumpOn ? styles.outerHaloGreen : styles.outerHaloGrey]}>
            <View style={[styles.outerRing, pumpOn ? styles.outerRingGreen : styles.outerRingGrey]}>
              <View style={[styles.innerCircle, pumpOn ? styles.innerCircleGreen : styles.innerCircleGrey]}>
                <MotorIcon size={70} color={pumpOn ? '#FFFFFF' : '#64748B'} />
              </View>
            </View>
          </View>

          {/* Running / Stopped Status text */}
          <View style={styles.statusBadgeRow}>
            <View style={[styles.liveDot, pumpOn ? styles.liveDotGreen : styles.liveDotGrey]} />
            <Text style={[styles.statusText, pumpOn ? styles.statusGreen : styles.statusGrey]}>
              {pumpOn ? t('swati.pumpIsRunning') : t('swati.pumpIsOff')}
            </Text>
          </View>

          {/* Solar Realtime Generation Chip */}
          {pumpOn && isSolar && solarKw != null ? (
            <View style={styles.solarBadge}>
              <Sun size={15} color="#D97706" />
              <Text style={styles.solarBadgeText}>
                {t('swati.solarPower', { kw: kwText(solarKw) })}
              </Text>
            </View>
          ) : null}

          {lastSeen ? (
            <Text style={styles.lastUpdatedText}>{t('swati.lastUpdated', { when: lastSeen })}</Text>
          ) : null}

          {/* Start/Stop Tactile Control Button */}
          <TouchableOpacity
            testID="power-button"
            style={[
              styles.mainActionButton,
              pumpOn ? styles.btnRed : styles.btnGreen,
              disabled && { opacity: 0.55 },
            ]}
            onPress={onPower}
            disabled={disabled}
            activeOpacity={0.88}
            accessibilityRole="button"
          >
            {pumpOn ? (
              <Square size={20} color="#FFFFFF" fill="#FFFFFF" style={{ marginEnd: 10 }} />
            ) : (
              <Play size={20} color="#FFFFFF" fill="#FFFFFF" style={{ marginEnd: 10 }} />
            )}
            <Text style={styles.btnText}>
              {pumpOn ? t('swati.stopPump') : t('swati.startPump')}
            </Text>
          </TouchableOpacity>

          {cooldownLeft > 0 ? (
            <View style={styles.cooldownPill}>
              <Text style={styles.cooldownNotice}>
                ⏳ {t('swati.nextCommandIn', { seconds: cooldownLeft })}
              </Text>
            </View>
          ) : null}
        </View>
      )}

      {/* 3. Quick Stats Cards (Runtime & Timer) */}
      <View style={styles.bottomStatsRow}>
        <TouchableOpacity
          style={styles.statCard}
          onPress={onOpenHistory}
          activeOpacity={0.82}
          accessibilityRole="button"
        >
          <View style={styles.statIconBoxBlue}>
            <Clock size={20} color="#0284C7" />
          </View>
          <View style={styles.statContent}>
            <Text style={styles.statLabel}>{t('swati.runtimeToday')}</Text>
            <Text style={styles.statValue}>{runtimeTodayText ?? '—'}</Text>
          </View>
          <ChevronRight size={16} color="#CBD5E1" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.statCard}
          onPress={onOpenTimer}
          activeOpacity={0.82}
          accessibilityRole="button"
        >
          <View style={styles.statIconBoxPurple}>
            <Calendar size={20} color="#7C3AED" />
          </View>
          <View style={styles.statContent}>
            <Text style={styles.statLabel}>{t('swati.timerTile')}</Text>
            <Text style={styles.statValue}>{timerText ?? t('swati.timerNone')}</Text>
          </View>
          <ChevronRight size={16} color="#CBD5E1" />
        </TouchableOpacity>
      </View>

      {/* 4. High-Tech Solar VFD Inverter Cockpit (Swati Solar Pumps) */}
      {isSolar && solar ? (
        <TouchableOpacity
          style={styles.solarCard}
          onPress={onOpenTechnical}
          activeOpacity={0.88}
          accessibilityRole="button"
        >
          <View style={styles.solarCardHeader}>
            <View style={styles.solarCardHeaderLeft}>
              <View style={styles.solarHeaderIconBox}>
                <Zap size={18} color="#D97706" />
              </View>
              <View>
                <Text style={styles.solarTitle}>FRENIC-Ace Drive Telemetry</Text>
                <Text style={styles.solarSubtitle}>Solar Inverter Modbus Loop (Port 2)</Text>
              </View>
            </View>
            <View style={styles.technicalLinkWrap}>
              <Text style={styles.technicalLinkText}>{t('swati.technical')}</Text>
              <ArrowRight size={14} color="#0284C7" />
            </View>
          </View>

          <View style={styles.solarGrid}>
            {[
              {
                label: t('swati.frequency'),
                value: formatReading(solar.hz, 1),
                unit: 'Hz',
                highlight: '#0284C7',
                barRatio: solar.hz != null ? Math.min(Math.max(solar.hz / 50, 0), 1) : 0,
              },
              {
                label: t('swati.power'),
                value: formatReading(solar.kw, 1),
                unit: 'kW',
                highlight: '#D97706',
              },
              {
                label: t('swati.dcVoltage'),
                value: formatReading(solar.vDc, 0),
                unit: 'V',
                highlight: '#EA580C',
              },
              {
                label: t('swati.outputCurrent'),
                value: formatReading(solar.iOut, 1),
                unit: 'A',
                highlight: '#7C3AED',
              },
              {
                label: t('swati.outputVoltage'),
                value: formatReading(solar.vAc, 0),
                unit: 'V',
                highlight: '#16A34A',
              },
              {
                label: t('swati.driveStatus'),
                value: driveStatusKey(solar.status)
                  ? t(driveStatusKey(solar.status) as string)
                  : solar.status ?? '—',
                unit: '',
                highlight:
                  solar.status?.toUpperCase() === 'RUNNING'
                    ? '#16A34A'
                    : solar.status?.toUpperCase() === 'TRIP'
                      ? '#DC2626'
                      : '#64748B',
              },
            ].map((item) => (
              <View key={item.label} style={styles.solarCell}>
                <View style={styles.cellHeader}>
                  <Text style={styles.solarLabel} numberOfLines={1}>
                    {item.label}
                  </Text>
                  {item.highlight ? (
                    <View style={[styles.cellAccentDot, { backgroundColor: item.highlight }]} />
                  ) : null}
                </View>

                <View style={styles.cellValueRow}>
                  <Text style={[styles.solarValue, { color: item.highlight || '#0F172A' }]}>
                    {item.value}
                  </Text>
                  {item.unit && item.value !== '—' ? (
                    <Text style={styles.solarUnit}>{item.unit}</Text>
                  ) : null}
                </View>

                {item.barRatio !== undefined && item.value !== '—' ? (
                  <View style={styles.frequencyTrack}>
                    <View
                      style={[
                        styles.frequencyFill,
                        { width: `${Math.round(item.barRatio * 100)}%` },
                      ]}
                    />
                  </View>
                ) : null}
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
    paddingTop: 10,
    paddingBottom: 24,
  },

  /* 1. Device Card */
  deviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    padding: 12,
    marginBottom: 20,
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  thumbWrap: {
    position: 'relative',
  },
  onlineBadgeDot: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: '#16A34A',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  deviceInfo: {
    flex: 1,
    marginStart: 12,
  },
  deviceHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deviceName: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.2,
  },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 8,
  },
  typeBadgeSolar: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  typeBadgeGrid: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  typeBadgeTextSolar: {
    color: '#B45309',
  },
  typeBadgeTextGrid: {
    color: '#1D4ED8',
  },
  hpBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  hpBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  switchPromptWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingStart: 6,
  },
  switchPromptText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },

  /* 2. Center Section */
  centerSection: {
    alignItems: 'center',
    marginVertical: 10,
  },
  outerHalo: {
    width: 196,
    height: 196,
    borderRadius: 98,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  outerHaloGreen: {
    backgroundColor: 'rgba(22, 163, 74, 0.08)',
  },
  outerHaloGrey: {
    backgroundColor: 'rgba(148, 163, 184, 0.08)',
  },
  outerRing: {
    width: 172,
    height: 172,
    borderRadius: 86,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  outerRingGreen: {
    backgroundColor: '#DCFCE7',
    borderWidth: 3.5,
    borderColor: '#86EFAC',
  },
  outerRingGrey: {
    backgroundColor: '#F8FAFC',
    borderWidth: 3.5,
    borderColor: '#E2E8F0',
  },
  innerCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerCircleGreen: {
    backgroundColor: '#16A34A',
    shadowColor: '#16A34A',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  innerCircleGrey: {
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#CBD5E1',
  },

  outerRingBlue: {
    width: 176,
    height: 176,
    borderRadius: 88,
    backgroundColor: '#E0F2FE',
    borderWidth: 3.5,
    borderColor: '#7DD3FC',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  innerCircleBlue: {
    width: 144,
    height: 144,
    borderRadius: 72,
    backgroundColor: '#BAE6FD',
    alignItems: 'center',
    justifyContent: 'center',
  },

  statusBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  liveDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  liveDotGreen: {
    backgroundColor: '#16A34A',
  },
  liveDotGrey: {
    backgroundColor: '#94A3B8',
  },
  statusText: {
    fontSize: 21,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  statusGreen: {
    color: '#15803D',
  },
  statusGrey: {
    color: '#0F172A',
  },
  statusTextBlue: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0369A1',
    textAlign: 'center',
    marginBottom: 4,
  },

  solarBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFBEB',
    paddingVertical: 5,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1.2,
    borderColor: '#FDE68A',
    marginBottom: 8,
  },
  solarBadgeText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#B45309',
  },
  lastUpdatedText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 20,
  },

  /* Main Action Button */
  mainActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 17,
    borderRadius: 16,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  },
  btnGreen: {
    backgroundColor: '#16A34A',
  },
  btnRed: {
    backgroundColor: '#DC2626',
  },
  btnBlueDisabled: {
    backgroundColor: '#0284C7',
    opacity: 0.88,
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  cooldownPill: {
    marginTop: 12,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  cooldownNotice: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
    textAlign: 'center',
  },

  /* 3. Bottom Stats Row */
  bottomStatsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 22,
  },
  statCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    padding: 12,
    shadowColor: '#0F172A',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  statIconBoxBlue: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#E0F2FE',
    alignItems: 'center',
    justifyContent: 'center',
    marginEnd: 10,
  },
  statIconBoxPurple: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#EDE9FE',
    alignItems: 'center',
    justifyContent: 'center',
    marginEnd: 10,
  },
  statContent: {
    flex: 1,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  statValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },

  /* 4. Solar VFD Cockpit Card */
  solarCard: {
    marginTop: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    padding: 16,
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  solarCardHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap', // the "Running parameters" chip drops under the title on a phone too narrow for both
    alignItems: 'center',
    justifyContent: 'space-between',
    rowGap: 8,
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  solarCardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  solarHeaderIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  solarTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  solarSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  technicalLinkWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F0F9FF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  technicalLinkText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0284C7',
  },
  solarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  solarCell: {
    width: '48.2%',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
  },
  cellHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  solarLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    flexShrink: 1,
  },
  cellAccentDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  cellValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    marginTop: 4,
  },
  solarValue: {
    fontSize: 19,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  solarUnit: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  frequencyTrack: {
    height: 4,
    backgroundColor: '#E2E8F0',
    borderRadius: 2,
    marginTop: 8,
    overflow: 'hidden',
  },
  frequencyFill: {
    height: '100%',
    backgroundColor: '#0284C7',
    borderRadius: 2,
  },

  /* Alert States */
  alertCardRed: {
    backgroundColor: '#FEF2F2',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
    padding: 16,
    marginVertical: 12,
  },
  alertHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  alertIconWrapRed: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertTitleWrap: {
    flex: 1,
  },
  alertBadgeRed: {
    fontSize: 11,
    fontWeight: '900',
    color: '#DC2626',
    letterSpacing: 0.5,
  },
  alertTitleRed: {
    fontSize: 16,
    fontWeight: '800',
    color: '#991B1B',
    marginTop: 2,
  },
  checklist: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  checkHeading: {
    fontSize: 14,
    fontWeight: '900',
    color: '#7F1D1D',
    marginBottom: 8,
  },
  checkItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginVertical: 3,
  },
  bulletRed: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#DC2626',
    marginTop: 6,
  },
  checkItem: {
    fontSize: 13,
    fontWeight: '700',
    color: '#450A0A',
    flex: 1,
    lineHeight: 18,
  },

  alertCardSun: {
    backgroundColor: '#FFFBEB',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#FDE68A',
    padding: 20,
    alignItems: 'center',
    marginVertical: 12,
  },
  solarStandbyPill: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
    marginBottom: 8,
  },
  solarStandbyPillText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#B45309',
    letterSpacing: 0.6,
  },
  alertCardAmber: {
    backgroundColor: '#FFFBEB',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#FDE68A',
    padding: 20,
    alignItems: 'center',
    marginVertical: 12,
  },
  alertIconWrapAmber: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  alertTitleAmber: {
    fontSize: 18,
    fontWeight: '800',
    color: '#92400E',
    textAlign: 'center',
    marginBottom: 6,
  },
  alertSubtitleAmber: {
    fontSize: 14,
    fontWeight: '600',
    color: '#78350F',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 6,
  },
  alertTimeAmber: {
    fontSize: 13,
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
});
