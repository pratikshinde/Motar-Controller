import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Fan, Power } from 'lucide-react-native';
import { colors, font, radius, cardShadow } from '@/shared/theme';
import type { PumpState } from '@/features/pumps/model';
import { SignalBars } from './Gauges';

/**
 * The light header card: pump identity, RUNNING/fault status, rotation warning, GSM bars, and the big
 * ON/OFF power button. The power button (size, colours, icon, glow) is deliberately the one farmers
 * already know: it is unchanged, only its surroundings moved from the old dark hero card to this one.
 */
export const PowerHero: React.FC<{
  name: string;
  hp: number | null | undefined;
  supplyType: string | null | undefined;
  rotation: 'ok' | 'wrong' | null;
  state: PumpState;
  signalDbm: number | null | undefined;
  busy: boolean;
  disabled: boolean;
  cooldownLeft: number;
  onPower: () => void;
}> = ({ name, hp, supplyType, rotation, state, signalDbm, busy, disabled, cooldownLeft, onPower }) => {
  const { t } = useTranslation();
  const pumpOn = state === 'running';
  const known = state === 'running' || state === 'stopped' || state === 'fault';
  const tint = pumpOn ? '#00c853' : '#ff3366';

  const powerLabel = !known ? t('live.notReporting') : pumpOn ? t('dashboard.powerOn') : t('dashboard.powerOff');
  const statusPill =
    state === 'running'
      ? { text: t('dashboard.running'), tone: 'ok' as const }
      : state === 'fault'
        ? { text: t('pumps.status.fault'), tone: 'danger' as const }
        : state === 'stopped'
          ? { text: t('dashboard.stopped'), tone: 'idle' as const }
          : { text: t(state === 'offline' ? 'pumps.status.offline' : 'pumps.noData'), tone: 'idle' as const };

  const pillStyle = {
    ok: { bg: colors.primarySoft, fg: colors.primaryDark, dot: colors.primary },
    danger: { bg: colors.dangerSoft, fg: colors.danger, dot: colors.danger },
    idle: { bg: colors.idleSoft, fg: colors.idle, dot: colors.idle },
  }[statusPill.tone];

  return (
    <View style={styles.card}>
      <View style={styles.left}>
        <View style={styles.iconBox}>
          <Fan size={26} color={colors.textOnPrimary} />
        </View>
        <View style={styles.titleGroup}>
          <Text style={styles.title} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.subtitle}>
            {(supplyType ?? '').toUpperCase()} {t('dashboard.system')}
            {hp ? ` · ${t('live.hp', { hp })}` : ''}
          </Text>
        </View>
      </View>

      <View style={styles.right}>
        <View style={styles.pillRow}>
          <View style={[styles.pill, { backgroundColor: pillStyle.bg }]}>
            <View style={[styles.dot, { backgroundColor: pillStyle.dot }]} />
            <Text style={[styles.pillText, { color: pillStyle.fg }]}>{statusPill.text}</Text>
          </View>
          {rotation === 'wrong' ? (
            <View style={[styles.pill, { backgroundColor: colors.dangerSoft }]}>
              <Text style={[styles.pillText, { color: colors.danger }]}>{t('dashboard.wrongRotation')}</Text>
            </View>
          ) : null}
          <SignalBars dbm={signalDbm} light />
        </View>

        <TouchableOpacity
          testID="power-button"
          style={[styles.powerBtn, pumpOn ? styles.powerBtnOn : styles.powerBtnOff, disabled && styles.powerDisabled]}
          onPress={onPower}
          disabled={disabled || busy}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={powerLabel}
          accessibilityState={{ disabled: disabled || busy, busy }}
        >
          {busy ? <ActivityIndicator size="small" color={tint} /> : <Power size={30} color={tint} />}
        </TouchableOpacity>
        <Text style={[styles.powerLabel, { color: tint }]}>{powerLabel}</Text>
        {cooldownLeft > 0 ? (
          <Text style={styles.cooldown}>{t('command.cooldownShort', { seconds: cooldownLeft })}</Text>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
    ...(cardShadow as object),
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1, minWidth: 160 },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleGroup: { flexShrink: 1 },
  title: { color: colors.text, fontSize: font.title, fontWeight: '900' },
  subtitle: { color: colors.textFaint, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginTop: 2 },
  right: { alignItems: 'flex-end', gap: 8 },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
  powerBtn: { width: 56, height: 56, borderRadius: 28, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  powerBtnOn: { borderColor: '#00c853', backgroundColor: '#00c85320' },
  powerBtnOff: { borderColor: '#ff3366', backgroundColor: '#ff336620' },
  powerDisabled: { opacity: 0.45 },
  powerLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  cooldown: { color: colors.warn, fontSize: 11, fontWeight: '800' },
});
