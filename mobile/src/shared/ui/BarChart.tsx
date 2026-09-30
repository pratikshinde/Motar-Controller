import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, font, radius } from '../theme';

export interface Bar {
  key: string;
  /** Short text under the bar; leave empty to skip it. */
  label: string;
  value: number;
  /** Full description for screen readers and the detail line. */
  description: string;
}

/**
 * A simple bar chart: one tappable bar per period, height proportional to `max`. Each bar reads
 * out its own value to screen readers, and tapping one selects it so its value can be shown in words.
 */
export const BarChart: React.FC<{
  bars: Bar[];
  max: number;
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  height?: number;
  color?: string;
}> = ({ bars, max, selectedKey, onSelect, height = 140, color = colors.primary }) => {
  const top = Math.max(1, max);
  return (
    <View>
      <View style={[styles.plot, { height }]}>
        {bars.map((b) => {
          const h = b.value <= 0 ? 3 : Math.max(6, (b.value / top) * (height - 8));
          const on = b.key === selectedKey;
          return (
            <TouchableOpacity
              key={b.key}
              style={styles.slot}
              onPress={() => onSelect?.(b.key)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={b.description}
              accessibilityState={{ selected: on }}
            >
              <View
                style={[
                  styles.bar,
                  { height: h, backgroundColor: b.value <= 0 ? colors.border : color },
                  on && { backgroundColor: colors.accent },
                ]}
              />
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={styles.labels}>
        {bars.map((b) => (
          <View key={b.key} style={[styles.slot, styles.labelSlot]}>
            {b.label ? <Text style={styles.label}>{b.label}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  plot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderBottomWidth: 1,
    borderBottomColor: colors.borderStrong,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: 4,
  },
  slot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%', paddingHorizontal: 1 },
  bar: { width: '80%', minWidth: 3, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  labels: { flexDirection: 'row', paddingHorizontal: 4, marginTop: 4 },
  // Only some bars carry a label, so it may spill into its empty neighbours instead of being cut off.
  labelSlot: { height: 18, overflow: 'visible' },
  label: {
    color: colors.textMuted,
    fontSize: font.caption - 1,
    fontWeight: '700',
    textAlign: 'center',
    width: 32,
    flexShrink: 0,
  },
});
