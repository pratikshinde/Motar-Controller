import React from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Minus, Plus } from 'lucide-react-native';
import { colors, font, radius, TOUCH } from '../theme';

/** A whole-number input with big − / + buttons, for people who would rather tap than type. */
export const NumberField: React.FC<{
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  onStep: (delta: number) => void;
  error?: string;
  lessLabel: string;
  moreLabel: string;
  testID?: string;
}> = ({ label, hint, value, onChange, onStep, error, lessLabel, moreLabel, testID }) => (
  <View style={styles.wrap}>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.row}>
      <TouchableOpacity
        style={styles.step}
        onPress={() => onStep(-1)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${lessLabel}`}
        activeOpacity={0.7}
      >
        <Minus size={26} color={colors.primary} />
      </TouchableOpacity>
      <TextInput
        testID={testID}
        style={[styles.input, !!error && styles.inputError]}
        value={value}
        onChangeText={(v) => onChange(v.replace(/[^\d]/g, '').slice(0, 4))}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={4}
        accessibilityLabel={label}
        selectTextOnFocus
      />
      <TouchableOpacity
        style={styles.step}
        onPress={() => onStep(1)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${moreLabel}`}
        activeOpacity={0.7}
      >
        <Plus size={26} color={colors.primary} />
      </TouchableOpacity>
    </View>
    {error ? (
      <Text style={styles.error} accessibilityRole="alert">
        {error}
      </Text>
    ) : hint ? (
      <Text style={styles.hint}>{hint}</Text>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  label: { color: colors.text, fontSize: font.body, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  step: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minWidth: 0, // a web <input> would otherwise refuse to shrink and push the + button out of the row
    minHeight: TOUCH,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: font.headline,
    fontWeight: '900',
    textAlign: 'center',
  },
  inputError: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  hint: { color: colors.textMuted, fontSize: font.caption + 1 },
  error: { color: colors.danger, fontSize: font.caption + 1, fontWeight: '800' },
});
