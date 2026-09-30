import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, font, radius } from '../theme';

/** A labelled reading. A value the pump has not reported is an em dash, never a made-up number. */
export const ValueTile: React.FC<{
  label: string;
  value: string | number | null | undefined;
  unit?: string;
  accent?: string;
}> = ({ label, value, unit, accent = colors.primary }) => {
  const missing = value === null || value === undefined || value === '';
  return (
    <View
      style={[styles.tile, { borderLeftColor: accent }]}
      accessible
      accessibilityLabel={`${label}: ${missing ? '—' : `${value} ${unit ?? ''}`.trim()}`}
    >
      <Text style={styles.label}>{label}</Text>
      <View style={styles.valueRow}>
        <Text style={[styles.value, missing && styles.missing]}>{missing ? '—' : String(value)}</Text>
        {!missing && unit ? <Text style={styles.unit}>{unit}</Text> : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minWidth: 130,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 5,
    borderRadius: radius.md,
    padding: 14,
  },
  label: { color: colors.textMuted, fontSize: 14, fontWeight: '700', marginBottom: 4 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' },
  value: { color: colors.text, fontSize: 26, fontWeight: '900' },
  missing: { color: colors.textFaint },
  unit: { color: colors.textFaint, fontSize: font.caption + 1 },
});
