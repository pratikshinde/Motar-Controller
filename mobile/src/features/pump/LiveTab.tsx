import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertTriangle,
  Clock,
  History,
  Play,
  ShieldCheck,
  Square,
  Timer as TimerIcon,
  WifiOff,
  XCircle,
  Zap,
} from 'lucide-react-native';
import type { PumpResponse } from '@/api/generated/model';
import { colors, font, radius } from '@/shared/theme';
import { Card, CardTitle } from '@/shared/ui/Card';
import { Banner } from '@/shared/ui/Banner';
import { ConfirmSheet } from '@/shared/ui/ConfirmSheet';
import { ListenButton } from '@/shared/ui/ListenButton';
import { faultName } from '@/shared/i18n/faults';
import { friendlyError } from '@/shared/i18n/errors';
import { formatHM, formatMinutes, formatReading, timeAgo } from '@/shared/i18n/format';
import { useNow, useOnline } from '@/shared/hooks/useOnline';
import { CommandStepper } from '@/features/commands/CommandStepper';
import { useCommandFlow } from '@/features/commands/useCommandFlow';
import { isFinished } from '@/features/commands/progress';
import { useGetPumpTimer } from '@/api/generated/farmer';
import { brand } from '@/config/brand';
import {
  canControl,
  displayName,
  hasKnownFault,
  isKnownHealthy,
  phaseIndicator,
  pumpState,
} from '@/features/pumps/model';
import type { CommandAction } from '@/state/commands';
import { VoltageRing } from './Gauges';
import { PlanBanner } from './PlanBanner';
import { PowerHero } from './PowerHero';

const AMP_FULL_SCALE = 20;

const CurrentBar: React.FC<{
  phase: 'R' | 'Y' | 'B';
  amps: number | null | undefined;
  color: string;
  labelColor: string;
  textColor: string;
}> = ({ phase, amps, color, labelColor, textColor }) => {
  const { t } = useTranslation();
  const width = typeof amps === 'number' ? Math.min(100, (amps / AMP_FULL_SCALE) * 100) : 0;
  return (
    <View style={styles.phaseRow}>
      <View style={[styles.phaseLabelBox, { backgroundColor: `${color}18`, borderColor: `${color}50` }]}>
        <Text style={[styles.phaseLabelText, { color: labelColor }]}>{phase}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { backgroundColor: color, width: `${width}%` }]}>
          <Text style={[styles.barValue, { color: textColor }]}>
            {formatReading(amps)} {t('dashboard.ampere')}
          </Text>
        </View>
      </View>
    </View>
  );
};

export const LiveTab: React.FC<{
  pump: PumpResponse;
  onOpenFaults: () => void;
  onOpenTimer: () => void;
  onOpenHistory: () => void;
  refreshFailed?: boolean;
  /** Read the pump again (the "check again" / "try again" buttons). */
  onRefresh?: () => void;
}> = ({ pump, onOpenFaults, onOpenTimer, onOpenHistory, refreshFailed, onRefresh }) => {
  const { t } = useTranslation();
  const router = useRouter();
  const online = useOnline();
  const now = useNow(30_000);
  const flow = useCommandFlow(pump);
  const [target, setTarget] = useState<CommandAction | null>(null);
  // The sheet keeps its wording while it slides away (target is null by then, and the pump has just changed state).
  const [lastTarget, setLastTarget] = useState<CommandAction>('START');
  if (target && target !== lastTarget) setLastTarget(target);
  const shownTarget = target ?? lastTarget;

  const state = pumpState(pump, now);
  const name = displayName(pump);
  const controllable = canControl(pump);
  const known = state === 'running' || state === 'stopped' || state === 'fault';
  const pumpOn = state === 'running';
  const healthy = isKnownHealthy(pump, now);
  const rotation = phaseIndicator(pump);
  const hasFault = hasKnownFault(pump, now);

  const isSolar = pump.device_type === 'SOLAR_VFD';
  const swati = brand.design === 'swati';

  // The command the farmer sent that is still being carried out (Swati's home shows "starting..." / "stopping...").
  const pending: 'START' | 'STOP' | null = flow.sending
    ? (target ?? lastTarget)
    : flow.attempt && !flow.attempt.failed && flow.progress && !isFinished(flow.progress) && flow.progress.kind !== 'notConfirmed'
      ? flow.attempt.action
      : null;

  const timer = useGetPumpTimer(pump.id).data?.timer;
  const timerText = timer
    ? (timer.off_duration_minutes ?? 0) > 0 && timer.cycle_count !== 1
      ? `${timer.on_duration_minutes}/${timer.off_duration_minutes} ${t('swati.minShort')}`
      : t('units.minutes', { m: timer.on_duration_minutes })
    : undefined;

  const powerDisabled = !online || !controllable || flow.cooldownLeft > 0 || flow.sending;
  const ago = timeAgo(t, pump.last_seen_at, now);

  const speech = useCallback(() => {
    if (state === 'nodata') return t('speech.noData', { name });
    if (state === 'offline') return t('speech.offline', { name, ago });
    const head =
      state === 'fault'
        ? t('speech.fault', {
            name,
            fault: pump.fault_code ? faultName(t, pump.fault_code) : t('faultInfo.unknown.cause'),
          })
        : t(state === 'running' ? 'speech.running' : 'speech.stopped', { name });
    const parts = [head];
    if (pump.v_ry != null && pump.v_yb != null && pump.v_br != null) {
      parts.push(
        t('speech.volts', { ry: Math.round(pump.v_ry), yb: Math.round(pump.v_yb), br: Math.round(pump.v_br) }),
      );
    }
    if (pump.runtime_today_min != null)
      parts.push(t('speech.runtime', { time: formatMinutes(t, pump.runtime_today_min) }));
    return parts.join(' ');
  }, [state, name, ago, pump, t]);

  const askPower = () => setTarget(state === 'running' ? 'STOP' : 'START');
  const confirm = () => {
    const action = target;
    setTarget(null);
    if (action) void flow.start(action);
  };

  return (
    <View style={styles.stack}>
      <PlanBanner pump={pump} now={now} />
      {!online ? <Banner tone="warn" icon={WifiOff} text={t('command.offlineBlock')} testID="control-offline" /> : null}
      {state === 'nodata' ? <Banner tone="info" text={t('live.noDataYet')} testID="no-data" /> : null}
      {state === 'offline' ? (
        <Banner tone="warn" icon={WifiOff} text={t('live.stale', { ago })} testID="pump-offline" />
      ) : null}
      {refreshFailed ? <Banner tone="warn" text={t('live.refreshFailed')} /> : null}

      <PowerHero
        name={name}
        hp={pump.hp_rating}
        supplyType={isSolar ? t('dashboard.solarSystem') : pump.supply_type}
        rotation={isSolar ? null : rotation}
        state={state}
        signalDbm={pump.signal_dbm ?? pump.gsm_rssi}
        busy={flow.sending}
        disabled={powerDisabled}
        cooldownLeft={flow.cooldownLeft}
        isSolar={isSolar}
        solarKw={pump.vfd_kw}
        faultCode={pump.fault_code}
        pending={pending}
        lastUpdatedText={pump.last_seen_at ? timeAgo(t, pump.last_seen_at, now) : undefined}
        runtimeTodayText={pump.runtime_today_min != null ? formatMinutes(t, pump.runtime_today_min) : undefined}
        timerText={timerText}
        solar={
          isSolar
            ? { hz: pump.vfd_hz, iOut: pump.vfd_i_out, vAc: pump.vfd_v_ac, vDc: pump.vfd_v_dc, kw: pump.vfd_kw, status: pump.vfd_status }
            : null
        }
        onOpenTechnical={() => router.push('/technical')}
        onPower={askPower}
        onRetry={onRefresh}
        onSelectPump={() => router.push('/pumps')}
        onOpenTimer={onOpenTimer}
        onOpenHistory={onOpenHistory}
      />

      <View style={styles.metaRow}>
        {swati ? <View /> : <Text style={styles.updated}>{t('live.updated', { ago })}</Text>}
        <ListenButton getText={speech} testID="listen" />
      </View>

      {flow.error ? (
        <Banner tone="danger" text={friendlyError(flow.error, t, 'command')} testID="command-error" />
      ) : null}
      {flow.attempt ? (
        <CommandStepper
          action={flow.attempt.action}
          progress={flow.progress}
          sendFailed={flow.attempt.failed}
          onRetry={flow.retry}
          onDismiss={flow.dismiss}
        />
      ) : null}

      {swati ? null : (
        <>
      {isSolar ? (
        <Card>
          <CardTitle icon={Zap} title={t('dashboard.solarTitle')} />
          <View style={styles.solarGrid}>
            <View style={[styles.solarBox, styles.solarBoxPrimary]}>
              <Text style={[styles.solarLabel, { color: colors.primaryDark }]}>{t('dashboard.frequencyHz')}</Text>
              <Text style={[styles.solarValue, { color: colors.primaryDark }]}>
                {formatReading(pump.vfd_hz, 1)}
              </Text>
              <Text style={styles.solarUnit}>{t('dashboard.unitHz')}</Text>
            </View>
            <View style={[styles.solarBox, styles.solarBoxAmber]}>
              <Text style={[styles.solarLabel, { color: colors.warn }]}>{t('dashboard.motorPowerKw')}</Text>
              <Text style={[styles.solarValue, { color: colors.warn }]}>
                {formatReading(pump.vfd_kw, 1)}
              </Text>
              <Text style={styles.solarUnit}>{t('dashboard.unitKw')}</Text>
            </View>
            <View style={[styles.solarBox, styles.solarBoxWater]}>
              <Text style={[styles.solarLabel, { color: colors.water }]}>{t('dashboard.dcVolts')}</Text>
              <Text style={[styles.solarValue, { color: colors.water }]}>
                {pump.vfd_v_dc != null ? String(Math.round(pump.vfd_v_dc)) : '—'}
              </Text>
              <Text style={styles.solarUnit}>{t('dashboard.unitVdc')}</Text>
            </View>
            <View style={[styles.solarBox, styles.solarBoxWater]}>
              <Text style={[styles.solarLabel, { color: colors.water }]}>{t('dashboard.acOutputVolts')}</Text>
              <Text style={[styles.solarValue, { color: colors.water }]}>
                {pump.vfd_v_ac != null ? String(Math.round(pump.vfd_v_ac)) : '—'}
              </Text>
              <Text style={styles.solarUnit}>{t('dashboard.unitVac')}</Text>
            </View>
            <View style={[styles.solarBox, styles.solarBoxPurple]}>
              <Text style={[styles.solarLabel, { color: colors.purple }]}>{t('dashboard.outputCurrentA')}</Text>
              <Text style={[styles.solarValue, { color: colors.purple }]}>
                {formatReading(pump.vfd_i_out, 1)}
              </Text>
              <Text style={styles.solarUnit}>{t('dashboard.ampere')}</Text>
            </View>
            <View style={[styles.solarBox, styles.solarBoxPrimary]}>
              <Text style={[styles.solarLabel, { color: colors.primaryDark }]}>{t('dashboard.vfdStatus')}</Text>
              <Text style={[styles.solarValue, { color: colors.primaryDark, fontSize: 18 }]}>
                {pump.vfd_status || (known ? (pumpOn ? t('dashboard.running') : t('dashboard.stopped')) : '—')}
              </Text>
              <Text style={styles.solarUnit}>FRENIC-Ace</Text>
            </View>
          </View>
        </Card>
      ) : (
        <>
          <Card>
            <CardTitle icon={Zap} title={t('dashboard.cardVoltages')} />
            <View style={styles.rings}>
              <VoltageRing phase="RY" voltage={pump.v_ry} color={colors.phaseR} />
              <VoltageRing phase="YB" voltage={pump.v_yb} color={colors.phaseY} />
              <VoltageRing phase="BR" voltage={pump.v_br} color={colors.phaseB} />
            </View>
          </Card>

          <Card>
            <CardTitle icon={Activity} title={t('dashboard.cardCurrents')} />
            {state === 'running' || state === 'fault' ? (
              <View style={styles.currents}>
                <CurrentBar
                  phase="R"
                  amps={pump.i_r}
                  color={colors.phaseR}
                  labelColor={colors.phaseR}
                  textColor="#FFFFFF"
                />
                <CurrentBar phase="Y" amps={pump.i_y} color={colors.phaseY} labelColor={colors.warn} textColor="#3B2A00" />
                <CurrentBar
                  phase="B"
                  amps={pump.i_b}
                  color={colors.phaseB}
                  labelColor={colors.phaseB}
                  textColor="#FFFFFF"
                />
              </View>
            ) : (
              <View style={styles.stopped}>
                <XCircle size={36} color={colors.textFaint} />
                <Text style={styles.stoppedText}>{known ? t('dashboard.offNoLoad') : t('live.noReading')}</Text>
              </View>
            )}
          </Card>
        </>
      )}

      <Card>
        <CardTitle icon={Clock} title={t('dashboard.cardRuntime2')} />
        <View style={styles.runtimeRow}>
          <View style={[styles.runtimeBox, styles.runtimeBoxGreen]}>
            <Text style={[styles.runtimeLabel, { color: colors.primaryDark }]}>{t('dashboard.totalRunTime')}</Text>
            <Text style={[styles.runtimeValue, { color: colors.primaryDark }]}>
              {formatHM(pump.total_runtime_min)}
            </Text>
            <Text style={styles.runtimeUnit}>{t('dashboard.hoursMinutes')}</Text>
          </View>
          <View style={[styles.runtimeBox, styles.runtimeBoxAmber]}>
            <Text style={[styles.runtimeLabel, { color: colors.warn }]}>{t('dashboard.lastCycleRunTime')}</Text>
            <Text style={[styles.runtimeValue, { color: colors.warn }]}>{formatHM(pump.runtime_today_min)}</Text>
            <Text style={styles.runtimeUnit}>{t('dashboard.hoursMinutes')}</Text>
          </View>
        </View>
      </Card>

      <Card>
        <CardTitle icon={AlertTriangle} title={t('dashboard.cardFaults')} />
        {hasFault ? (
          <TouchableOpacity style={styles.faultRow} onPress={onOpenFaults} activeOpacity={0.8}>
            <View style={styles.faultRowLeft}>
              <AlertTriangle size={20} color={colors.danger} />
              <Text style={styles.faultRowName} numberOfLines={1}>
                {pump.fault_code ? faultName(t, pump.fault_code) : t('faultInfo.unknown.cause')}
              </Text>
            </View>
            <View style={styles.faultBadge}>
              <Text style={styles.faultBadgeText}>{t('pumps.status.fault')}</Text>
            </View>
          </TouchableOpacity>
        ) : healthy ? (
          <View style={styles.healthy}>
            <ShieldCheck size={36} color={colors.ok} />
            <Text style={styles.healthyText}>{t('dashboard.noFaults')}</Text>
          </View>
        ) : (
          <Text style={styles.unknownHealth}>
            {state === 'nodata' ? t('live.noDataYet') : t('live.stale', { ago })}
          </Text>
        )}
      </Card>

      <Card>
        <CardTitle icon={TimerIcon} title={t('dashboard.quickActions')} />
        <View style={styles.quickGrid}>
          <TouchableOpacity
            style={[styles.quickBtn, { backgroundColor: colors.primarySoft }, (powerDisabled || pumpOn) && styles.quickBtnDisabled]}
            onPress={() => setTarget('START')}
            disabled={powerDisabled || pumpOn}
            activeOpacity={0.8}
          >
            <Play size={20} color={colors.primaryDark} />
            <Text style={[styles.quickBtnText, { color: colors.primaryDark }]}>{t('dashboard.startPump')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.quickBtn, { backgroundColor: colors.dangerSoft }, (powerDisabled || !pumpOn) && styles.quickBtnDisabled]}
            onPress={() => setTarget('STOP')}
            disabled={powerDisabled || !pumpOn}
            activeOpacity={0.8}
          >
            <Square size={20} color={colors.danger} />
            <Text style={[styles.quickBtnText, { color: colors.danger }]}>{t('dashboard.stopPump')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.quickBtn, { backgroundColor: colors.waterSoft }]}
            onPress={onOpenTimer}
            activeOpacity={0.8}
          >
            <TimerIcon size={20} color={colors.water} />
            <Text style={[styles.quickBtnText, { color: colors.water }]}>{t('dashboard.viewTimer')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.quickBtn, { backgroundColor: colors.purpleSoft }]}
            onPress={onOpenHistory}
            activeOpacity={0.8}
          >
            <History size={20} color={colors.purple} />
            <Text style={[styles.quickBtnText, { color: colors.purple }]}>{t('dashboard.viewHistory')}</Text>
          </TouchableOpacity>
        </View>
      </Card>
        </>
      )}

      <ConfirmSheet
        visible={target !== null}
        title={t(shownTarget === 'START' ? 'command.startTitle' : 'command.stopTitle', { name })}
        message={[
          t(shownTarget === 'START' ? 'command.startBody' : 'command.stopBody', { name }),
          state === 'offline' || state === 'nodata' ? t('command.offlineWarn') : '',
        ]
          .filter(Boolean)
          .join('\n\n')}
        confirmLabel={t(shownTarget === 'START' ? 'dashboard.yesStart' : 'dashboard.yesStop')}
        cancelLabel={t('dashboard.no')}
        tone={shownTarget === 'START' ? 'primary' : 'danger'}
        onConfirm={confirm}
        onCancel={() => setTarget(null)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  stack: { gap: 16 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  updated: { color: colors.textMuted, fontSize: font.caption + 1, fontWeight: '600', flexShrink: 1 },
  rings: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-start' },
  currents: { gap: 12 },
  phaseRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  phaseLabelBox: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phaseLabelText: { fontSize: 15, fontWeight: '900' },
  barTrack: {
    flex: 1,
    height: 34,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 7,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingEnd: 8,
    minWidth: 84,
  },
  barValue: { fontSize: 14, fontWeight: '900' },
  stopped: { height: 100, alignItems: 'center', justifyContent: 'center', gap: 8 },
  stoppedText: { color: colors.textMuted, fontSize: font.body, fontWeight: '700', textAlign: 'center' },
  runtimeRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  runtimeBox: { flex: 1, minWidth: 140, borderRadius: radius.md, padding: 14, borderWidth: 1 },
  runtimeBoxGreen: { backgroundColor: colors.primarySoft, borderColor: colors.primaryBorder },
  runtimeBoxAmber: { backgroundColor: colors.accentSoft, borderColor: '#FFE8B3' },
  runtimeLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  runtimeValue: { fontSize: 24, fontWeight: '900', fontVariant: ['tabular-nums'], marginTop: 6 },
  runtimeUnit: { color: colors.textFaint, fontSize: 10, fontWeight: '700', marginTop: 4 },
  solarGrid: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  solarBox: { flex: 1, minWidth: 140, borderRadius: radius.md, padding: 14, borderWidth: 1 },
  solarBoxPrimary: { backgroundColor: colors.primarySoft, borderColor: colors.primaryBorder },
  solarBoxAmber: { backgroundColor: colors.accentSoft, borderColor: '#FFE8B3' },
  solarBoxWater: { backgroundColor: colors.waterSoft, borderColor: '#B8DBFF' },
  solarBoxPurple: { backgroundColor: colors.purpleSoft, borderColor: '#E1D0FF' },
  solarLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  solarValue: { fontSize: 24, fontWeight: '900', fontVariant: ['tabular-nums'], marginTop: 6 },
  solarUnit: { color: colors.textFaint, fontSize: 10, fontWeight: '700', marginTop: 4 },
  faultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: '#FFD1DC',
    borderRadius: radius.md,
    padding: 14,
  },
  faultRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  faultRowName: { color: colors.danger, fontSize: font.body, fontWeight: '800', flexShrink: 1 },
  faultBadge: { backgroundColor: colors.danger, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  faultBadgeText: { color: colors.textOnPrimary, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
  healthy: { alignItems: 'center', gap: 8, paddingVertical: 12 },
  healthyText: { color: colors.ok, fontSize: font.bodyLg, fontWeight: '800', textAlign: 'center' },
  unknownHealth: { color: colors.textMuted, fontSize: font.body, textAlign: 'center', paddingVertical: 12 },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quickBtn: {
    flexBasis: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 52,
    borderRadius: radius.md,
  },
  quickBtnDisabled: { opacity: 0.4 },
  quickBtnText: { fontSize: font.body, fontWeight: '800' },
});
