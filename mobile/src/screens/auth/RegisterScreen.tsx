import React, { useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { User as UserIcon, Phone, ArrowRight } from 'lucide-react-native';
import { colors } from '@/shared/theme';
import { normalizePhone } from '@/shared/phone';
import { friendlyError } from '@/shared/i18n/errors';
import { sendPhoneVerification } from '@/api/phoneVerification';
import { useAuthFlow } from '@/state/authFlow';
import { AuthShell, authStyles as s } from './AuthShell';

interface RegisterScreenProps {
  onBack: () => void;
  onSent: () => void;
  onLoginLink: () => void;
}

export const RegisterScreen: React.FC<RegisterScreenProps> = ({ onBack, onSent, onLoginLink }) => {
  const { t } = useTranslation();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    setError(null);
    if (!fullName.trim()) return setError(t('login.needName'));
    const clean = normalizePhone(phone);
    if (!/^\+91\d{10}$/.test(clean)) return setError(t('login.needPhone'));

    setLoading(true);
    try {
      const res = await sendPhoneVerification(clean, 'registration');
      useAuthFlow.getState().setFullName(fullName.trim());
      useAuthFlow.getState().startVerification('registration', clean, res.dev_otp ?? null);
      onSent();
    } catch (err) {
      setError(friendlyError(err, t, 'register'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell onBack={onBack}>
      <Text style={s.title}>{t('login.createTitle')}</Text>
      <Text style={s.desc}>{t('login.createDesc')}</Text>

      {error && (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}

      <Text style={s.label}>{t('login.nameLabel')}</Text>
      <View style={s.inputWrap}>
        <UserIcon size={20} color={colors.textMuted} style={s.inputIcon} />
        <TextInput
          style={s.input}
          value={fullName}
          onChangeText={setFullName}
          placeholder={t('login.namePlaceholder')}
          placeholderTextColor={colors.textFaint}
        />
      </View>

      <Text style={s.label}>{t('login.mobileLabel')}</Text>
      <View style={s.inputWrap}>
        <View style={s.flagChip}>
          <Text style={s.flagText}>🇮🇳</Text>
          <Text style={s.ccText}>+91</Text>
        </View>
        <Phone size={20} color={colors.textMuted} style={s.inputIcon} />
        <TextInput
          style={s.input}
          value={phone}
          onChangeText={setPhone}
          placeholder={t('login.mobilePlaceholder')}
          placeholderTextColor={colors.textFaint}
          keyboardType="phone-pad"
          maxLength={10}
        />
      </View>

      <TouchableOpacity
        style={[s.submitBtn, loading && { opacity: 0.7 }]}
        onPress={handleSend}
        disabled={loading}
        activeOpacity={0.85}
      >
        {loading ? (
          <ActivityIndicator color={colors.textOnPrimary} />
        ) : (
          <>
            <Text style={s.submitBtnText}>{t('login.sendOtpButton')}</Text>
            <ArrowRight size={20} color={colors.textOnPrimary} />
          </>
        )}
      </TouchableOpacity>

      <View style={s.footerRow}>
        <Text style={s.footerText}>{t('login.haveAccount')}</Text>
        <TouchableOpacity onPress={onLoginLink}>
          <Text style={s.footerLink}>{t('login.loginLink')}</Text>
        </TouchableOpacity>
      </View>
    </AuthShell>
  );
};
