import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, font, radius, TOUCH } from '../theme';

/** One consistent full-screen loading / error / empty state for every screen. */
export const StateView: React.FC<{
  kind: 'loading' | 'error' | 'empty';
  title: string;
  message?: string;
  icon?: any;
  actionLabel?: string;
  onAction?: () => void;
}> = ({ kind, title, message, icon: Icon, actionLabel, onAction }) => {
  const tint = kind === 'error' ? colors.danger : colors.primary;
  const soft = kind === 'error' ? colors.dangerSoft : colors.primarySoft;
  return (
    <View style={styles.wrap}>
      {kind === 'loading' ? (
        <ActivityIndicator size="large" color={colors.primary} />
      ) : Icon ? (
        <View style={[styles.iconCircle, { backgroundColor: soft }]}>
          <Icon size={38} color={tint} />
        </View>
      ) : null}
      <Text style={[styles.title, kind === 'error' && { color: colors.danger }]}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <TouchableOpacity style={styles.btn} onPress={onAction} activeOpacity={0.85} accessibilityRole="button">
          <Text style={styles.btnText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: { color: colors.text, fontSize: font.title, fontWeight: '800', textAlign: 'center' },
  message: { color: colors.textMuted, fontSize: font.body, textAlign: 'center', lineHeight: 23 },
  btn: {
    marginTop: 8,
    minHeight: TOUCH,
    paddingHorizontal: 28,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { color: colors.textOnPrimary, fontSize: font.bodyLg, fontWeight: '800' },
});
