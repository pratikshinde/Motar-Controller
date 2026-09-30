import React, { useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { KeyRound, Eye, EyeOff } from 'lucide-react-native';
import { http } from '@/api/http';
import { colors } from '@/shared/theme';
import { friendlyError } from '@/shared/i18n/errors';
import { useAuthFlow } from '@/state/authFlow';
import { AuthShell, authStyles as s } from './AuthShell';

interface ResetPasswordScreenProps {
  onBack: () => void;
  onDone: () => void;
}

export const ResetPasswordScreen: React.FC<ResetPasswordScreenProps> = ({ onBack, onDone }) => {
  const { t } = useTranslation();
  const { phone, verificationToken } = useAuthFlow();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (password.length < 8) return setError(t('createPassword.tooShort'));
    if (password !== confirm) return setError(t('createPassword.mismatch'));

    setLoading(true);
    try {
      await http.post('/auth/reset-password', {
        phone_number: phone,
        verification_token: verificationToken,
        new_password: password,
      });
      useAuthFlow.getState().reset();
      onDone();
    } catch (err) {
      setError(friendlyError(err, t, 'load'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell onBack={onBack}>
      <Text style={s.title}>{t('resetPassword.title')}</Text>
      <Text style={s.desc}>{t('resetPassword.desc')}</Text>

      {error && (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}

      <Text style={s.label}>{t('resetPassword.newPasswordLabel')}</Text>
      <View style={s.inputWrap}>
        <KeyRound size={20} color={colors.textMuted} style={s.inputIcon} />
        <TextInput
          style={s.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!show}
          autoCapitalize="none"
          placeholder="••••••••"
          placeholderTextColor={colors.textFaint}
        />
        <TouchableOpacity onPress={() => setShow((v) => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          {show ? <EyeOff size={20} color={colors.textMuted} /> : <Eye size={20} color={colors.textMuted} />}
        </TouchableOpacity>
      </View>
      <Text style={{ color: colors.textFaint, fontSize: 12, marginTop: 4 }}>{t('createPassword.passwordReq')}</Text>

      <Text style={s.label}>{t('createPassword.confirmLabel')}</Text>
      <View style={s.inputWrap}>
        <KeyRound size={20} color={colors.textMuted} style={s.inputIcon} />
        <TextInput
          style={s.input}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry={!show}
          autoCapitalize="none"
          placeholder="••••••••"
          placeholderTextColor={colors.textFaint}
        />
      </View>

      <TouchableOpacity
        style={[s.submitBtn, loading && { opacity: 0.7 }]}
        onPress={handleSubmit}
        disabled={loading}
        activeOpacity={0.85}
      >
        {loading ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={s.submitBtnText}>{t('resetPassword.submitButton')}</Text>}
      </TouchableOpacity>
    </AuthShell>
  );
};
