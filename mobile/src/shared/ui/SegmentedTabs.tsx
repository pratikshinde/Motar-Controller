import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radius, TOUCH } from '../theme';

export interface TabOption<K extends string> {
  key: K;
  label: string;
}

/** Equal-width, always-labelled tabs (pump screen sections, history periods). */
export function SegmentedTabs<K extends string>({
  options,
  value,
  onChange,
}: {
  options: TabOption<K>[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <TouchableOpacity
            key={o.key}
            onPress={() => onChange(o.key)}
            style={[styles.tab, on && styles.tabOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            activeOpacity={0.8}
          >
            <Text style={[styles.label, on && styles.labelOn]} numberOfLines={2}>
              {o.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', backgroundColor: colors.idleSoft, borderRadius: radius.lg, padding: 4, gap: 4 },
  tab: {
    flex: 1,
    minHeight: TOUCH - 8,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabOn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  label: { color: colors.textMuted, fontSize: 14.5, fontWeight: '800', textAlign: 'center' },
  labelOn: { color: colors.primary },
});
