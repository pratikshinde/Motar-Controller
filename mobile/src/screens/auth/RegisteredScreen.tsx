import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, ArrowRight } from 'lucide-react-native';
import { colors, font, radius, space } from '@/shared/theme';
import { useAuthFlow } from '@/state/authFlow';
import { AuthShell, authStyles as s } from './AuthShell';

interface RegisteredScreenProps {
  onContinue: () => void;
}

export const RegisteredScreen: React.FC<RegisteredScreenProps> = ({ onContinue }) => {
  const { t } = useTranslation();
  const { phone } = useAuthFlow();

  return (
    <AuthShell showLogo={false}>
      <View style={styles.iconWrap}>
        <CheckCircle2 size={64} color={colors.primary} />
      </View>
      <Text style={[s.title, styles.center]}>{t('registered.title')}</Text>
      <Text style={[s.desc, styles.center]}>{t('registered.desc')}</Text>

      <View style={styles.phoneBox}>
        <Text style={styles.phoneLabel}>{t('registered.phoneLabel')}</Text>
        <Text style={styles.phoneValue}>{phone}</Text>
      </View>

      <TouchableOpacity
        style={s.submitBtn}
        onPress={() => {
          useAuthFlow.getState().reset();
          onContinue();
        }}
        activeOpacity={0.85}
      >
        <Text style={s.submitBtnText}>{t('registered.continueButton')}</Text>
        <ArrowRight size={20} color={colors.textOnPrimary} />
      </TouchableOpacity>
    </AuthShell>
  );
};

const styles = StyleSheet.create({
  iconWrap: { alignItems: 'center', marginBottom: space.md },
  center: { textAlign: 'center' },
  phoneBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    alignItems: 'center',
    marginTop: space.sm,
  },
  phoneLabel: { color: colors.textFaint, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  phoneValue: { color: colors.text, fontSize: font.title, fontWeight: '800', marginTop: 4 },
});
