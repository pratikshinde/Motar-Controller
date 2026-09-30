import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AlertTriangle, Info } from 'lucide-react-native';
import { colors, radius, TOUCH } from '../theme';

export type BannerTone = 'info' | 'warn' | 'danger';

const TONES = {
  info: { bg: colors.waterSoft, fg: '#0B4F9A', Icon: Info },
  warn: { bg: colors.warnSoft, fg: colors.warn, Icon: AlertTriangle },
  danger: { bg: colors.dangerSoft, fg: colors.danger, Icon: AlertTriangle },
} as const;

/** A short message strip: colour + icon + words, with an optional action. */
export const Banner: React.FC<{
  tone: BannerTone;
  text: string;
  icon?: React.ComponentType<{ size?: number; color?: string }>;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}> = ({ tone, text, icon, actionLabel, onAction, testID }) => {
  const c = TONES[tone];
  const Icon = icon ?? c.Icon;
  return (
    <View style={[styles.wrap, { backgroundColor: c.bg }]} accessibilityRole="alert" testID={testID}>
      <Icon size={20} color={c.fg} />
      <Text style={[styles.text, { color: c.fg }]}>{text}</Text>
      {actionLabel && onAction ? (
        <TouchableOpacity onPress={onAction} style={styles.action} accessibilityRole="button">
          <Text style={[styles.actionText, { color: c.fg }]}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: 12, borderRadius: radius.md },
  text: { flex: 1, fontSize: 15, fontWeight: '700', lineHeight: 21, minWidth: 180 },
  action: { minHeight: TOUCH - 12, justifyContent: 'center', paddingHorizontal: 6 },
  actionText: { fontSize: 15, fontWeight: '900', textDecorationLine: 'underline' },
});
