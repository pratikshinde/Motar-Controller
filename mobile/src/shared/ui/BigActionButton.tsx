import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, font, radius, TOUCH } from '../theme';

export type ActionTone = 'primary' | 'danger' | 'neutral';

const TONES: Record<ActionTone, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.primary, fg: colors.textOnPrimary, border: colors.primary },
  danger: { bg: colors.danger, fg: '#FFFFFF', border: colors.danger },
  neutral: { bg: colors.surface, fg: colors.text, border: colors.borderStrong },
};

/** A large, always-labelled button (>= 56dp) for anything that acts on a pump. */
export const BigActionButton: React.FC<{
  label: string;
  onPress: () => void;
  tone?: ActionTone;
  icon?: React.ComponentType<{ size?: number; color?: string }>;
  loading?: boolean;
  disabled?: boolean;
  hint?: string;
  testID?: string;
}> = ({ label, onPress, tone = 'primary', icon: Icon, loading, disabled, hint, testID }) => {
  const c = TONES[tone];
  const inactive = disabled || loading;
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={[styles.btn, { backgroundColor: c.bg, borderColor: c.border }, inactive && styles.inactive]}
    >
      {loading ? (
        <ActivityIndicator color={c.fg} />
      ) : (
        <View style={styles.row}>
          {Icon ? <Icon size={22} color={c.fg} /> : null}
          <Text style={[styles.label, { color: c.fg }]}>{label}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  btn: {
    minHeight: TOUCH,
    borderRadius: radius.lg,
    borderWidth: 2,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  label: { fontSize: font.bodyLg, fontWeight: '800', textAlign: 'center', flexShrink: 1 },
  inactive: { opacity: 0.5 },
});
