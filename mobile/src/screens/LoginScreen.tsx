import React, { useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Phone, KeyRound, ArrowRight, Eye, EyeOff } from 'lucide-react-native';
import { useAuth } from '@/state/auth';
import { colors } from '@/shared/theme';
import { normalizePhone } from '@/shared/phone';
import { friendlyError } from '../shared/i18n/errors';
import { AuthShell, authStyles as s } from './auth/AuthShell';

interface LoginScreenProps {
  onLoginSuccess: () => void;
  onForgotPassword: () => void;
  onRegister: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess, onForgotPassword, onRegister }) => {
  const { t } = useTranslation();
  const expired = useAuth((st) => st.expired);

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(expired ? t('errors.sessionExpired') : null);

  const handleLogin = async () => {
    setError(null);
    if (!phone.trim()) return setError(t('login.needPhone'));
    if (!password.trim()) return setError(t('login.needPassword'));

    setLoading(true);
    try {
      await useAuth.getState().signIn(normalizePhone(phone), password.trim());
      onLoginSuccess();
    } catch (err: any) {
      const errorMsg = friendlyError(err, t, 'login');
      if (err.response?.status === 404) {
        setError(t('login.notFoundMessage'));
      } else {
        setError(errorMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <Text style={s.title}>{t('login.welcomeBack')}</Text>
      <Text style={s.desc}>{t('login.welcomeBackDesc')}</Text>

      {error && (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}

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

      <Text style={s.label}>{t('login.passwordLabel')}</Text>
      <View style={s.inputWrap}>
        <KeyRound size={20} color={colors.textMuted} style={s.inputIcon} />
        <TextInput
          style={s.input}
          value={password}
          onChangeText={setPassword}
          placeholder={t('login.passwordPlaceholder')}
          placeholderTextColor={colors.textFaint}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
        />
        <TouchableOpacity
          onPress={() => setShowPassword((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={showPassword ? t('login.hidePassword') : t('login.showPassword')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {showPassword ? <EyeOff size={20} color={colors.textMuted} /> : <Eye size={20} color={colors.textMuted} />}
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={onForgotPassword} style={{ alignSelf: 'flex-end', marginTop: 10 }}>
        <Text style={s.footerLink}>{t('login.forgotPassword')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[s.submitBtn, loading && { opacity: 0.7 }]}
        onPress={handleLogin}
        disabled={loading}
        activeOpacity={0.85}
      >
        {loading ? (
          <ActivityIndicator color={colors.textOnPrimary} />
        ) : (
          <>
            <Text style={s.submitBtnText}>{t('login.loginButton')}</Text>
            <ArrowRight size={20} color={colors.textOnPrimary} />
          </>
        )}
      </TouchableOpacity>

      <View style={s.footerRow}>
        <Text style={s.footerText}>{t('login.newHere')}</Text>
        <TouchableOpacity onPress={onRegister}>
          <Text style={s.footerLink}>{t('login.createLink')}</Text>
        </TouchableOpacity>
      </View>
    </AuthShell>
  );
};
