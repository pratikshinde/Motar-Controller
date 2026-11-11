import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  Clock,
  HelpCircle,
  History,
  Power,
  RefreshCw,
  ShieldCheck,
  Sun,
  Wifi,
  WifiOff,
  Zap,
  ZapOff,
} from 'lucide-react-native';
import type { PumpResponse } from '@/api/generated/model';
import { faultName } from '@/shared/i18n/faults';
import { formatHM, formatMinutes, formatWhen } from '@/shared/i18n/format';
import { useDirection } from '@/shared/i18n/useDirection';
import { PumpThumbnail } from '@/shared/ui/PumpThumbnail';
import { faultInfoKeys, faultKind } from '@/features/faults/info';
import { GsmQuality, PumpState, gsmLevel, hasKnownFault, phaseIndicator } from '@/features/pumps/model';

import { colors } from '@/shared/theme';
import { mix } from '@/shared/theme/color';
/**
 * Ajanta's Live screen, top to bottom: the pump card (power button, name, status icons), the line voltages as coloured
 * tiles, the phase currents as bars, the phase sequence and run time side by side, and the faults card. Every number is the
 * pump's own reading, shown in whole units like the starter's display; a pump that is not reporting shows 0 and a grey mark,
 * never a green tick. A fault is a warning (amber) and is shown once, in the banner above the pump card.
 */

const INK = colors.text;
const MUTED = colors.textMuted;
const GREEN = '#0B8A43';
const RED = '#C62833';
const AMBER = '#F59E0B';
const AMBER_DARK = '#B45309';
const AMBER_INK = '#78350F';
const CARD_BORDER = colors.border;
const TRACK = colors.primarySoft;
const PHASE_R = '#E12220';
const PHASE_Y = '#F5B000';
const PHASE_B = '#0B73F0';
/** The same full scale as the classic current bars. */
const AMP_FULL_SCALE = 20;
/** Under this a line voltage means "no power" (the same cut-off the classic rings use). */
const DEAD_VOLTS = 20;

type Tone = { card: string; border: string; button: string; ring: string; halo: string; caption: string };

const TONES: Record<'on' | 'off' | 'fault' | 'idle' | 'busy', Tone> = {
  on: { card: '#EBF9ED', border: '#CDEED6', button: '#02A44E', ring: '#86EAB4', halo: '#DDF6E6', caption: GREEN },
  off: { card: '#F3F5F8', border: '#E2E8F0', button: '#DC3545', ring: '#F5B8C0', halo: '#FBE3E6', caption: RED },
  // A fault is a warning, not an alarm: amber, not red.
  fault: { card: '#FFF8E1', border: '#F5D98B', button: AMBER, ring: '#FCD58A', halo: '#FEEFC8', caption: AMBER_DARK },
  idle: { card: '#FEF8E7', border: '#FBE6AE', button: '#94A3B8', ring: '#CBD5E1', halo: '#EEF1F5', caption: '#92400E' },
  busy: { card: colors.primarySoft, border: colors.primaryBorder, button: colors.primary, ring: mix(colors.primary, colors.primarySoft, 0.5), halo: mix(colors.primarySoft, '#FFFFFF', 0.5), caption: colors.primaryDark },
};

const QUALITY_KEY: Record<GsmQuality, string> = {
  excellent: 'home.signalExcellent',
  good: 'home.signalGood',
  fair: 'home.signalFair',
  poor: 'home.signalPoor',
  none: 'home.signalNone',
};

/** True when the phone is set to reduce motion: nothing here then animates. */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) setReduce(v);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return reduce;
}

/** Fades and slides its children in once, when the screen opens. */
const FadeIn: React.FC<{ delay?: number; children: React.ReactNode }> = ({ delay = 0, children }) => {
  const reduce = useReduceMotion();
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduce) {
      v.setValue(1);
      return;
    }
    Animated.timing(v, { toValue: 1, duration: 420, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [v, delay, reduce]);
  return (
    <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
      {children}
    </Animated.View>
  );
};

/** A bar that grows to its width instead of jumping. */
const GrowBar: React.FC<{ percent: number; color: string }> = ({ percent, color }) => {
  const reduce = useReduceMotion();
  const [w] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduce) {
      w.setValue(percent);
      return;
    }
    Animated.timing(w, { toValue: percent, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [w, percent, reduce]);
  return (
    <View style={styles.track}>
      <Animated.View
        style={[styles.fill, { backgroundColor: color, width: w.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }]}
      />
    </View>
  );
};

/** The module's mobile signal, as a phone shows it: four bars and the dBm it measured. No bars and no number when the pump is not reporting. */
const GsmBars: React.FC<{ dbm: number | null | undefined }> = ({ dbm }) => {
  const { t } = useTranslation();
  const { bars, quality } = gsmLevel(dbm);
  const word = t(QUALITY_KEY[quality]);
  return (
    <View
      style={styles.pill}
      accessible
      accessibilityLabel={`GSM, ${word}${quality === 'none' ? '' : `, ${dbm} dBm`}`}
      testID="gsm-signal"
    >
      <View style={styles.gsmRow}>
        {[8, 13, 18, 23].map((height, i) => (
          <View key={height} style={[styles.gsmStick, { height }, i < bars ? styles.gsmOn : styles.gsmOff]} />
        ))}
      </View>
      <Text style={styles.pillText} numberOfLines={1}>
        {quality === 'none' ? '—' : `${dbm} dBm`}
      </Text>
    </View>
  );
};

/** A round status icon with a short caption under it. */
const Pill: React.FC<{ label: string; tone: 'ok' | 'warn' | 'idle'; icon: React.ReactNode; text?: string; testID?: string }> = ({
  label,
  tone,
  icon,
  text,
  testID,
}) => (
  <View style={styles.pill} accessible accessibilityLabel={label} testID={testID}>
    <View style={[styles.pillIcon, tone === 'ok' ? styles.pillOk : tone === 'warn' ? styles.pillWarn : styles.pillIdle]}>{icon}</View>
    {text ? (
      <Text style={styles.pillText} numberOfLines={1}>
        {text}
      </Text>
    ) : null}
  </View>
);

interface AjantaHeroProps {
  name: string;
  hp: number | null | undefined;
  state: PumpState;
  signalDbm: number | null | undefined;
  /** The command being carried out right now, if any. */
  pending: 'START' | 'STOP' | null;
  disabled: boolean;
  cooldownLeft: number;
  /** How long ago the pump last reported, or undefined when it never has. */
  lastSeenAgo?: string;
  /** Whether the pump is known to be free of faults, has one, or is not known (not reporting). */
  faultStatus: 'ok' | 'fault' | 'unknown';
  /** A small control that sits with the status icons (the read-aloud button). */
  extra?: React.ReactNode;
  onPower: () => void;
  /** Given only when the farmer has more than one pump: tapping the name opens "My pumps". */
  onSelectPump?: () => void;
}

/** The card with the big power button, the pump's name and the status icons. */
export const AjantaHero: React.FC<AjantaHeroProps> = ({
  name,
  hp,
  state,
  signalDbm,
  pending,
  disabled,
  cooldownLeft,
  lastSeenAgo,
  faultStatus,
  extra,
  onPower,
  onSelectPump,
}) => {
  const { t } = useTranslation();
  const { flip } = useDirection();
  const working = pending !== null;
  const [press] = useState(() => new Animated.Value(1));
  const tone = working
    ? TONES.busy
    : state === 'running'
      ? TONES.on
      : state === 'fault'
        ? TONES.fault
        : state === 'stopped'
          ? TONES.off
          : TONES.idle;
  const caption = working
    ? t(pending === 'STOP' ? 'swati.stopping' : 'swati.starting')
    : state === 'running'
      ? t('dashboard.powerOn')
      : state === 'stopped'
        ? t('dashboard.powerOff')
        : state === 'fault'
          ? t('pumps.status.fault')
          : t('live.notReporting');

  const reporting = state === 'running' || state === 'stopped' || state === 'fault';
  const link = reporting
    ? { tone: 'ok' as const, label: t('home.controllerConnected') }
    : state === 'offline'
      ? { tone: 'warn' as const, label: t('pumps.status.offline') }
      : { tone: 'idle' as const, label: t('pumps.noData') };
  const faultLabel =
    faultStatus === 'fault' ? t('pumps.status.fault') : faultStatus === 'ok' ? t('home.noFaultsTitle') : t('live.noReading');
  const spec = [t('swati.type3Phase'), hp ? t('pumps.hp', { hp }) : null].filter(Boolean).join(' • ');

  const identity = (
    <>
      <PumpThumbnail type="3PHASE" size={52} />
      <Text style={styles.name} numberOfLines={2}>
        {name}
      </Text>
      {onSelectPump ? <ChevronRight size={20} color={MUTED} style={flip} /> : null}
    </>
  );

  return (
    <FadeIn>
      <View style={[styles.hero, { backgroundColor: tone.card, borderColor: tone.border }]}>
        <View style={styles.heroLeft}>
          <Animated.View style={{ transform: [{ scale: press }] }}>
            <View style={[styles.halo, { borderColor: tone.ring, backgroundColor: tone.halo }]}>
              <Pressable
                testID="power-button"
                style={[styles.powerButton, { backgroundColor: tone.button }, disabled && !working && styles.powerDisabled]}
                onPress={onPower}
                onPressIn={() => Animated.spring(press, { toValue: 0.94, useNativeDriver: true, speed: 40, bounciness: 0 }).start()}
                onPressOut={() => Animated.spring(press, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 8 }).start()}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={caption}
                accessibilityState={{ disabled, busy: working }}
              >
                {working ? (
                  <ActivityIndicator size="large" color="#FFFFFF" />
                ) : state === 'fault' ? (
                  <AlertTriangle size={44} color="#FFFFFF" strokeWidth={2.4} />
                ) : (
                  <Power size={44} color="#FFFFFF" strokeWidth={2.6} />
                )}
              </Pressable>
            </View>
          </Animated.View>
          <View style={[styles.captionPill, { backgroundColor: tone.halo }]}>
            <View style={[styles.captionDot, { backgroundColor: tone.button }]} />
            <Text style={[styles.caption, { color: tone.caption }]} numberOfLines={1}>
              {caption}
            </Text>
          </View>
          {cooldownLeft > 0 ? <Text style={styles.cooldown}>{`${cooldownLeft}s`}</Text> : null}
        </View>

        <View style={[styles.divider, { backgroundColor: tone.border }]} />

        <View style={styles.heroRight}>
          {onSelectPump ? (
            <TouchableOpacity
              style={styles.identity}
              onPress={onSelectPump}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`${name}, ${t('pumps.title')}`}
              testID="switch-pump"
            >
              {identity}
            </TouchableOpacity>
          ) : (
            <View style={styles.identity}>{identity}</View>
          )}
          <View style={styles.specChip}>
            <Zap size={13} color={colors.primary} />
            <Text style={styles.specText} numberOfLines={1}>
              {spec}
            </Text>
          </View>
          <View style={styles.pills}>
            <Pill
              label={link.label}
              tone={link.tone}
              icon={reporting ? <Wifi size={18} color="#FFFFFF" strokeWidth={2.6} /> : <WifiOff size={18} color="#FFFFFF" strokeWidth={2.4} />}
              testID="link-status"
            />
            <GsmBars dbm={reporting ? signalDbm : null} />
            <Pill
              label={lastSeenAgo ?? t('live.noReading')}
              tone={reporting ? 'ok' : 'idle'}
              icon={<Clock size={18} color="#FFFFFF" strokeWidth={2.4} />}
              text={lastSeenAgo ?? '—'}
              testID="last-seen"
            />
            <Pill
              label={faultLabel}
              tone={faultStatus === 'ok' ? 'ok' : faultStatus === 'fault' ? 'warn' : 'idle'}
              icon={
                faultStatus === 'fault' ? (
                  <AlertTriangle size={18} color="#FFFFFF" strokeWidth={2.4} />
                ) : faultStatus === 'ok' ? (
                  <ShieldCheck size={18} color="#FFFFFF" strokeWidth={2.4} />
                ) : (
                  <HelpCircle size={18} color="#FFFFFF" strokeWidth={2.4} />
                )
              }
              testID="fault-status"
            />
            {extra ? <View style={styles.pill}>{extra}</View> : null}
          </View>
        </View>
      </View>
    </FadeIn>
  );
};

interface AjantaPowerBannerProps {
  /** "ON" or "OFF": whether the power is on at the pump. */
  state: string;
  /** When it last changed (ISO). */
  since: string | null | undefined;
  /** "VOLTAGE" (the starter said so) or "CONTACT" (it went quiet, so the power may be off). */
  source: string | null | undefined;
}

/**
 * The power at the pump, on the Home page: "Power is ON since 6:42 AM" (green) or "Power is OFF since 7:15 PM" (amber). It is what the
 * phone's notification says too, so the notification and this page always agree. "May be off" when the pump simply stopped reporting.
 */
export const AjantaPowerBanner: React.FC<AjantaPowerBannerProps> = ({ state, since, source }) => {
  const { t, i18n } = useTranslation();
  const on = state === 'ON';
  const title = on ? t('home.powerOn') : source === 'CONTACT' ? t('home.powerMaybeOff') : t('home.powerOff');
  const when = since ? t('home.powerSince', { when: formatWhen(i18n.language, since) }) : null;
  const Icon = on ? Zap : ZapOff;
  return (
    <FadeIn>
      <View
        testID="power-banner"
        style={[styles.powerBanner, on ? styles.powerBannerOn : styles.powerBannerOff]}
        accessible
        accessibilityRole="summary"
        accessibilityLabel={[title, when].filter(Boolean).join('. ')}
      >
        <View style={[styles.powerIcon, { backgroundColor: on ? colors.ok : AMBER }]}>
          <Icon size={22} color="#FFFFFF" />
        </View>
        <View style={styles.powerText}>
          <Text style={[styles.powerTitle, { color: on ? colors.ok : AMBER_DARK }]}>{title}</Text>
          {when ? <Text style={styles.powerWhen}>{when}</Text> : null}
        </View>
      </View>
    </FadeIn>
  );
};

interface AjantaFaultBannerProps {
  code: number | null | undefined;
  onPress: () => void;
}

/** The fault, above the pump card: its kind (current or voltage), its name and what to do. The name is the starter's own wording. */
export const AjantaFaultBanner: React.FC<AjantaFaultBannerProps> = ({ code, onPress }) => {
  const { t } = useTranslation();
  const { flip } = useDirection();
  const kind = faultKind(code);
  const kindLabel = kind ? t(kind === 'current' ? 'home.faultKindCurrent' : 'home.faultKindVoltage') : null;
  const name = code ? faultName(t, code) : t('faultInfo.unknown.cause');
  const action = t(faultInfoKeys(code).action);
  return (
    <FadeIn>
      <TouchableOpacity
        testID="fault-banner"
        style={styles.faultBanner}
        onPress={onPress}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={[kindLabel, name, action].filter(Boolean).join('. ')}
      >
        <View style={styles.faultIcon}>
          <AlertTriangle size={26} color="#FFFFFF" />
        </View>
        <View style={styles.faultText}>
          {kindLabel ? <Text style={styles.faultKind}>{kindLabel}</Text> : null}
          <Text style={styles.faultTitle} numberOfLines={3}>
            {name}
          </Text>
          <Text style={styles.faultAction} numberOfLines={3}>
            {action}
          </Text>
        </View>
        <ChevronRight size={22} color={AMBER_DARK} style={flip} />
      </TouchableOpacity>
    </FadeIn>
  );
};

type StatusTone = 'ok' | 'warn' | 'idle';

/** A small rounded status: a mark and a short word. Never "OK" for something that is not known. */
const StatusChip: React.FC<{ tone: StatusTone; label: string }> = ({ tone, label }) => (
  <View
    accessible
    accessibilityLabel={label}
    style={[styles.chip, tone === 'ok' ? styles.chipOk : tone === 'warn' ? styles.chipWarn : styles.chipIdle]}
  >
    {tone === 'ok' ? (
      <Check size={14} color={GREEN} strokeWidth={3.4} />
    ) : tone === 'warn' ? (
      <AlertTriangle size={14} color={AMBER_DARK} strokeWidth={2.6} />
    ) : (
      <HelpCircle size={14} color={MUTED} strokeWidth={2.6} />
    )}
    <Text style={[styles.chipText, { color: tone === 'ok' ? GREEN : tone === 'warn' ? AMBER_DARK : MUTED }]} numberOfLines={1}>
      {label}
    </Text>
  </View>
);

const Head: React.FC<{
  icon: React.ComponentType<{ size?: number; color?: string }>;
  color: string;
  title: string;
  right?: React.ReactNode;
}> = ({ icon: Icon, color, title, right }) => (
  <View style={styles.head} accessible accessibilityRole="header" accessibilityLabel={title}>
    <View style={styles.headLeft}>
      <Icon size={22} color={color} />
      <Text style={styles.headTitle} numberOfLines={1}>
        {title}
      </Text>
    </View>
    {right}
  </View>
);

/** A line voltage as a coloured tile, whole volts like the starter's display. `dim` = not reporting: grey and 0. */
const VoltTile: React.FC<{ label: string; value: number | null | undefined; bg: string; fg: string; dim?: boolean }> = ({
  label,
  value,
  bg,
  fg,
  dim,
}) => {
  const shown = dim ? 0 : typeof value === 'number' ? Math.round(value) : null;
  return (
    <View style={[styles.tile, { backgroundColor: dim ? colors.surfaceAlt : bg }]} accessible accessibilityLabel={`${label} ${shown ?? '—'} V`}>
      <Text style={[styles.tileLabel, { color: dim ? '#94A3B8' : fg }]}>{label}</Text>
      <View style={styles.tileValueRow}>
        <Text style={[styles.tileValue, { color: dim ? '#94A3B8' : fg }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          {shown === null ? '—' : String(shown)}
        </Text>
        <Text style={[styles.tileUnit, { color: dim ? '#94A3B8' : fg }]}>V</Text>
      </View>
    </View>
  );
};

const CurrentRow: React.FC<{ phase: string; amps: number | null | undefined; color: string; fill: string; dim?: boolean }> = ({
  phase,
  amps,
  color,
  fill,
  dim,
}) => {
  const percent = typeof amps === 'number' ? Math.min(100, Math.max(0, (amps / AMP_FULL_SCALE) * 100)) : 0;
  return (
    <View style={styles.currentRow} accessible accessibilityLabel={`${phase} ${typeof amps === 'number' ? Math.round(amps) : '—'} A`}>
      <View style={[styles.phaseBadge, { backgroundColor: dim ? '#CBD5E1' : color }]}>
        <Text style={styles.phaseBadgeText}>{phase}</Text>
      </View>
      <Text style={[styles.currentValue, dim && { color: '#94A3B8' }]} numberOfLines={1}>
        {typeof amps === 'number' ? `${Math.round(amps)}` : '—'}
        <Text style={styles.currentUnit}> A</Text>
      </Text>
      <GrowBar percent={percent} color={dim ? '#CBD5E1' : fill} />
    </View>
  );
};

const PhaseDot: React.FC<{ letter: string; color: string }> = ({ letter, color }) => (
  <View style={[styles.seqDot, { backgroundColor: color }]}>
    <Text style={styles.seqLetter}>{letter}</Text>
  </View>
);

interface AjantaCardsProps {
  pump: PumpResponse;
  state: PumpState;
  now: number;
  onOpenHistory: () => void;
}

/** The cards under the pump card. */
export const AjantaCards: React.FC<AjantaCardsProps> = ({ pump, state, now, onOpenHistory }) => {
  const { t } = useTranslation();
  const reporting = state === 'running' || state === 'stopped' || state === 'fault';

  const volts = [pump.v_ry, pump.v_yb, pump.v_br];
  const voltsKnown = volts.filter((v): v is number => typeof v === 'number');
  const voltTone: StatusTone = !reporting || voltsKnown.length < 3 ? 'idle' : voltsKnown.some((v) => v < DEAD_VOLTS) ? 'warn' : 'ok';
  const voltLabel = voltTone === 'ok' ? t('home.statusOk') : voltTone === 'warn' ? t('dashboard.noPower') : t('live.noReading');

  const loaded = state === 'running' || state === 'fault';
  const ampsKnown = [pump.i_r, pump.i_y, pump.i_b].every((a) => typeof a === 'number');
  const currentTone: StatusTone | null = !reporting
    ? 'idle'
    : state === 'fault'
      ? 'warn'
      : state === 'running'
        ? ampsKnown
          ? 'ok'
          : 'idle'
        : null;
  const currentLabel = currentTone === 'ok' ? t('home.statusOk') : currentTone === 'warn' ? t('pumps.status.fault') : t('live.noReading');

  // There is no phase-sequence sensor: the order is only ever "right" for a motor that runs without a fault, and "wrong" on fault 4.
  // A pump that has gone quiet is never "right": only a trip on fault 4 it last reported still stands.
  const rotation = reporting ? phaseIndicator(pump) : pump.fault_code === 4 && hasKnownFault(pump, now) ? 'wrong' : null;
  const seqTone: StatusTone = rotation === 'ok' ? 'ok' : rotation === 'wrong' ? 'warn' : 'idle';
  const seqLabel = rotation === 'ok' ? t('home.sequenceOk') : rotation === 'wrong' ? t('dashboard.wrongRotation') : t('live.noReading');
  const seqLit = rotation === 'ok';

  const total = typeof pump.total_runtime_min === 'number' ? pump.total_runtime_min : null;
  const hasFault = hasKnownFault(pump, now);
  const healthy = reporting && !hasFault;

  return (
    <>
      <FadeIn delay={80}>
        <View style={styles.card}>
          <Head icon={Zap} color={colors.primary} title={t('home.lineVoltages')} right={<StatusChip tone={voltTone} label={voltLabel} />} />
          <View style={styles.tiles}>
            {/* Nothing connected (never reported, or gone quiet): 0 V, grey. */}
            <VoltTile label="R-Y" value={pump.v_ry} bg="#FDE8E8" fg="#D32F2F" dim={!reporting} />
            <VoltTile label="Y-B" value={pump.v_yb} bg="#FEF3D0" fg="#B87A0C" dim={!reporting} />
            <VoltTile label="B-R" value={pump.v_br} bg="#E3EDFC" fg="#1A47B8" dim={!reporting} />
          </View>
        </View>
      </FadeIn>

      <FadeIn delay={140}>
        <View style={styles.card}>
          <Head
            icon={Activity}
            color={colors.primary}
            title={t('home.phaseCurrents')}
            right={currentTone ? <StatusChip tone={currentTone} label={currentLabel} /> : null}
          />
          <View style={styles.currents}>
            <CurrentRow phase="R" amps={loaded ? pump.i_r : 0} color="#E42821" fill="#FC544F" dim={!loaded} />
            <CurrentRow phase="Y" amps={loaded ? pump.i_y : 0} color="#E9A400" fill="#FFBB03" dim={!loaded} />
            <CurrentRow phase="B" amps={loaded ? pump.i_b : 0} color="#0A74F0" fill="#2E8BFF" dim={!loaded} />
          </View>
        </View>
      </FadeIn>

      <FadeIn delay={200}>
        <View style={styles.pair}>
          <View style={[styles.card, styles.half]}>
            <Head icon={RefreshCw} color={colors.primary} title={t('home.phaseSequence')} />
            <View style={styles.seqRow}>
              <PhaseDot letter="R" color={seqLit ? PHASE_R : '#CBD5E1'} />
              <ArrowRight size={16} color="#8A97A8" />
              <PhaseDot letter="Y" color={seqLit ? PHASE_Y : '#CBD5E1'} />
              <ArrowRight size={16} color="#8A97A8" />
              <PhaseDot letter="B" color={seqLit ? PHASE_B : '#CBD5E1'} />
            </View>
            <StatusChip tone={seqTone} label={seqLabel} />
          </View>

          <TouchableOpacity
            style={[styles.card, styles.half]}
            onPress={onOpenHistory}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={t('home.runTime')}
            testID="run-time-card"
          >
            <Head icon={Clock} color={colors.primary} title={t('home.runTime')} right={<ChevronRight size={18} color="#94A3B8" />} />
            <View style={[styles.runTile, { backgroundColor: colors.primarySoft }]} accessible accessibilityLabel={t('swati.runtimeToday')}>
              <Sun size={22} color={colors.primary} />
              <View style={styles.runText}>
                <Text style={styles.runLabel}>{t('live.today')}</Text>
                <Text style={styles.runValue} numberOfLines={1}>
                  {formatMinutes(t, pump.runtime_today_min)}
                </Text>
              </View>
            </View>
            {total !== null ? (
              <View style={[styles.runTile, { backgroundColor: colors.primarySoft }]} accessible accessibilityLabel={t('dashboard.totalRunTime')}>
                <History size={22} color={colors.primaryDark} />
                <View style={styles.runText}>
                  <Text style={styles.runLabel}>{t('live.total')}</Text>
                  <Text style={styles.runValue} numberOfLines={1}>
                    {formatHM(total)}
                  </Text>
                </View>
              </View>
            ) : null}
          </TouchableOpacity>
        </View>
      </FadeIn>

      {/* A fault is shown once, in the banner above the pump card; this card is only for "no faults" / "not known". */}
      {hasFault ? null : (
        <FadeIn delay={260}>
          <View style={styles.card}>
            <Head icon={AlertTriangle} color={AMBER} title={t('home.pumpFaults')} />
            <View style={[styles.faultsOk, healthy ? styles.chipOk : styles.chipIdle]}>
              {healthy ? <Check size={20} color="#FFFFFF" strokeWidth={3.4} style={styles.faultsOkIcon} /> : <HelpCircle size={20} color={MUTED} />}
              <Text style={[styles.faultsOkText, { color: healthy ? GREEN : MUTED }]}>
                {healthy ? t('home.noFaultsTitle') : t('live.noReading')}
              </Text>
            </View>
          </View>
        </FadeIn>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  /* Hero */
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 24,
    borderWidth: 1,
    padding: 12,
    elevation: 2,
    shadowColor: colors.shadowTint,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  heroLeft: { width: 124, alignItems: 'center', gap: 8 },
  halo: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  powerButton: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: colors.shadowTint,
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  },
  powerDisabled: { opacity: 0.5 },
  captionPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, maxWidth: 124 },
  captionDot: { width: 8, height: 8, borderRadius: 4 },
  caption: { fontSize: 13, fontWeight: '900', letterSpacing: 0.3, flexShrink: 1 },
  cooldown: { color: '#A15C00', fontSize: 13, fontWeight: '800', textAlign: 'center' },
  divider: { width: 1, alignSelf: 'stretch', opacity: 0.9 },
  heroRight: { flex: 1, minWidth: 0, gap: 8 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, color: INK, fontSize: 16, fontWeight: '900' },
  specChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: '100%',
  },
  specText: { color: colors.primaryDark, fontSize: 12, fontWeight: '800', flexShrink: 1 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8, columnGap: '3.5%', justifyContent: 'flex-start' },
  pill: { alignItems: 'center', width: '31%', gap: 3, minHeight: 56, justifyContent: 'flex-start' },
  pillIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  pillOk: { backgroundColor: '#0AA24A' },
  pillWarn: { backgroundColor: AMBER },
  pillIdle: { backgroundColor: '#A8B3C2' },
  pillText: { color: MUTED, fontSize: 11, fontWeight: '700' },
  gsmRow: { height: 36, flexDirection: 'row', alignItems: 'flex-end', gap: 2, paddingBottom: 4 },
  gsmStick: { width: 5, borderRadius: 2 },
  gsmOn: { backgroundColor: '#02A44E' },
  gsmOff: { backgroundColor: '#C9D6CE' },

  /* Power banner */
  powerBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, borderWidth: 1.5, paddingVertical: 10, paddingHorizontal: 12 },
  powerBannerOn: { backgroundColor: colors.okSoft, borderColor: mix(colors.ok, '#FFFFFF', 0.7) },
  powerBannerOff: { backgroundColor: '#FFF8E1', borderColor: '#F2C45A' },
  powerIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  powerText: { flex: 1, minWidth: 0 },
  powerTitle: { fontSize: 17, fontWeight: '900' },
  powerWhen: { color: MUTED, fontSize: 14, fontWeight: '700', marginTop: 1 },

  /* Fault banner */
  faultBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFF8E1',
    borderWidth: 1.5,
    borderColor: '#F2C45A',
    borderRadius: 18,
    padding: 12,
  },
  faultIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: AMBER, alignItems: 'center', justifyContent: 'center' },
  faultText: { flex: 1, minWidth: 0, gap: 2 },
  faultKind: { color: AMBER_DARK, fontSize: 13, fontWeight: '900', letterSpacing: 0.5 },
  faultTitle: { color: AMBER_INK, fontSize: 18, fontWeight: '900' },
  faultAction: { color: MUTED, fontSize: 14, fontWeight: '600', lineHeight: 19 },

  /* Cards */
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 14,
    elevation: 2,
    shadowColor: colors.shadowTint,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 10 },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  headTitle: { color: INK, fontSize: 17, fontWeight: '800', flexShrink: 1 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, flexShrink: 1 },
  chipOk: { backgroundColor: '#E3F6EA' },
  chipWarn: { backgroundColor: '#FEF0CE' },
  chipIdle: { backgroundColor: colors.surfaceAlt },
  chipText: { fontSize: 13, fontWeight: '800', flexShrink: 1 },

  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1, minWidth: 0, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center' },
  tileLabel: { fontSize: 15, fontWeight: '900', letterSpacing: 0.5 },
  tileValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3, marginTop: 2 },
  tileValue: { fontSize: 30, fontWeight: '900', fontVariant: ['tabular-nums'], flexShrink: 1 },
  tileUnit: { fontSize: 15, fontWeight: '800' },

  currents: { gap: 10 },
  currentRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  phaseBadge: { width: 36, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  phaseBadgeText: { color: '#FFFFFF', fontSize: 17, fontWeight: '900' },
  currentValue: { width: 62, color: INK, fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
  currentUnit: { color: MUTED, fontSize: 14, fontWeight: '700' },
  track: { flex: 1, height: 16, borderRadius: 8, backgroundColor: TRACK, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 8 },

  pair: { flexDirection: 'row', gap: 10 },
  half: { flex: 1, minWidth: 0, gap: 8 },
  seqRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: colors.surfaceAlt, borderRadius: 14, paddingVertical: 10 },
  seqDot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  seqLetter: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },

  runTile: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 10 },
  runText: { flex: 1, minWidth: 0 },
  runLabel: { color: MUTED, fontSize: 12, fontWeight: '700' },
  runValue: { color: INK, fontSize: 17, fontWeight: '900' },

  faultsOk: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 12 },
  faultsOkIcon: { backgroundColor: '#0AA24A', borderRadius: 12, padding: 3, overflow: 'hidden' },
  faultsOkText: { fontSize: 17, fontWeight: '800', flexShrink: 1 },
});
