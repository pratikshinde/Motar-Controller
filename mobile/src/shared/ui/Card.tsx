import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, font, radius, shadow, space } from '../theme';

export const Card: React.FC<{ children: React.ReactNode; style?: StyleProp<ViewStyle> }> = ({ children, style }) => (
  <View style={[styles.card, style]}>{children}</View>
);

export const CardTitle: React.FC<{
  icon?: React.ComponentType<{ size?: number; color?: string }>;
  title: string;
  right?: React.ReactNode;
}> = ({ icon: Icon, title, right }) => (
  <View style={styles.titleRow}>
    <View style={styles.titleLeft}>
      {Icon ? <Icon size={22} color={colors.primary} /> : null}
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
    </View>
    {right}
  </View>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: space.lg,
    ...(shadow as object),
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: 12,
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  titleLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  title: { color: colors.text, fontSize: font.bodyLg, fontWeight: '800', flexShrink: 1 },
});
