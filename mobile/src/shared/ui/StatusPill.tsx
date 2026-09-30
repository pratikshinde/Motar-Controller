import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CheckCircle2, AlertTriangle, WifiOff, PauseCircle } from 'lucide-react-native';
import { colors, radius } from '../theme';

export type PillTone = 'ok' | 'warn' | 'danger' | 'idle';

const TONES: Record<PillTone, { fg: string; bg: string; Icon: any }> = {
  ok: { fg: colors.ok, bg: colors.okSoft, Icon: CheckCircle2 },
  warn: { fg: colors.warn, bg: colors.warnSoft, Icon: AlertTriangle },
  danger: { fg: colors.danger, bg: colors.dangerSoft, Icon: AlertTriangle },
  idle: { fg: colors.idle, bg: colors.idleSoft, Icon: PauseCircle },
};

/**
 * Status is always colour + icon + word - never colour alone (colour-blind users,
 * sunlight glare). Pass `icon` to override the tone's default icon.
 */
export const StatusPill: React.FC<{
  tone: PillTone;
  label: string;
  icon?: any;
  size?: 'sm' | 'md';
}> = ({ tone, label, icon, size = 'md' }) => {
  const t = TONES[tone];
  const Icon = icon || t.Icon;
  const big = size === 'md';
  return (
    <View style={[styles.pill, { backgroundColor: t.bg, paddingVertical: big ? 6 : 3 }]}>
      <Icon size={big ? 16 : 13} color={t.fg} />
      <Text style={[styles.text, { color: t.fg, fontSize: big ? 14 : 12 }]}>{label}</Text>
    </View>
  );
};

export { WifiOff };

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  text: { fontWeight: '800', letterSpacing: 0.2 },
});
