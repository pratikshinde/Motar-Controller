import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CheckCircle2 } from 'lucide-react-native';
import { colors, space } from '@/shared/theme';
import { AuthShell, authStyles as s } from './AuthShell';

interface PasswordUpdatedScreenProps {
  onGoToLogin: () => void;
}

export const PasswordUpdatedScreen: React.FC<PasswordUpdatedScreenProps> = ({ onGoToLogin }) => {
  const { t } = useTranslation();
  return (
    <AuthShell showLogo={false}>
      <View style={styles.iconWrap}>
        <CheckCircle2 size={64} color={colors.primary} />
      </View>
      <Text style={[s.title, styles.center]}>{t('passwordUpdated.title')}</Text>
      <Text style={[s.desc, styles.center]}>{t('passwordUpdated.desc')}</Text>

      <TouchableOpacity style={s.submitBtn} onPress={onGoToLogin} activeOpacity={0.85}>
        <Text style={s.submitBtnText}>{t('passwordUpdated.goToLogin')}</Text>
      </TouchableOpacity>
    </AuthShell>
  );
};

const styles = StyleSheet.create({
  iconWrap: { alignItems: 'center', marginBottom: space.md },
  center: { textAlign: 'center' },
});
