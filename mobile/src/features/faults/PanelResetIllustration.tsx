import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { colors, font } from '@/shared/theme';

/**
 * Where to reset a fault: on the pump panel, not in the app. A drawing of the panel with the
 * RESET button highlighted, and the three steps in words.
 */
export const PanelResetIllustration: React.FC = () => {
  const { t } = useTranslation();
  const steps = ['faults.resetStep1', 'faults.resetStep2', 'faults.resetStep3'];
  return (
    <View style={styles.wrap} testID="reset-illustration">
      <Text style={styles.intro}>{t('faults.resetIntro')}</Text>
      <View
        style={styles.figure}
        accessible
        accessibilityLabel={`${t('faults.panelLabel')}: ${t('faults.resetButton')}`}
      >
        <Svg width="240" height="150" viewBox="0 0 240 150">
          <Rect
            x="8"
            y="8"
            width="224"
            height="134"
            rx="14"
            fill="#E9EFE6"
            stroke={colors.borderStrong}
            strokeWidth="3"
          />
          <Rect x="24" y="24" width="88" height="34" rx="6" fill="#0D2B20" />
          <Circle cx="132" cy="41" r="7" fill="#00e676" />
          <Circle cx="156" cy="41" r="7" fill="#F2A900" />
          <Circle cx="180" cy="41" r="7" fill="#ff1744" />
          <Circle cx="120" cy="100" r="28" fill="none" stroke={colors.accent} strokeWidth="4" strokeDasharray="6 5" />
          <Circle cx="120" cy="100" r="20" fill={colors.danger} />
          <Path d="M110 100 a10 10 0 1 1 3 7" stroke="#FFFFFF" strokeWidth="3" fill="none" strokeLinecap="round" />
          <Path
            d="M108 108 l-2 -8 l8 2"
            stroke="#FFFFFF"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
        <Text style={styles.reset}>{t('faults.resetButton')}</Text>
      </View>
      <View style={styles.steps}>
        {steps.map((key, i) => (
          <View key={key} style={styles.step}>
            <View style={styles.num}>
              <Text style={styles.numText}>{i + 1}</Text>
            </View>
            <Text style={styles.stepText}>{t(key)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  intro: { color: colors.textMuted, fontSize: font.body, lineHeight: 23 },
  figure: { alignItems: 'center', gap: 4 },
  reset: { color: colors.danger, fontSize: font.body, fontWeight: '900', letterSpacing: 1 },
  steps: { gap: 10 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  num: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numText: { color: colors.textOnPrimary, fontSize: font.body, fontWeight: '900' },
  stepText: { flex: 1, color: colors.text, fontSize: font.body, fontWeight: '700', lineHeight: 23 },
});
