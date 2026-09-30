import React, { useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { KeyRound, Eye, EyeOff } from 'lucide-react-native';
import { http } from '@/api/http';
import { setTokens, getInstallId } from '@/api/session';
import { useAuth } from '@/state/auth';
import { useAuthFlow } from '@/state/authFlow';
import { colors } from '@/shared/theme';
import { friendlyError } from '@/shared/i18n/errors';
import type { UserOut } from '@/api/generated/model';
import { AuthShell, authStyles as s } from './AuthShell';

interface CreatePasswordScreenProps {
  onBack: () => void;
  onDone: () => void;
}

interface RegisterResponse {
  access_token: string;
  refresh_token: string;
  user: UserOut;
}

export const CreatePasswordScreen: React.FC<CreatePasswordScreenProps> = ({ onBack, onDone }) => {
  const { t } = useTranslation();
  const { phone, fullName, verificationToken } = useAuthFlow();
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
      const { data } = await http.post<RegisterResponse>('/auth/register', {
        full_name: fullName,
        phone_number: phone,
        password,
        phone_verification_token: verificationToken,
        app_install_id: await getInstallId(),
      });
      await setTokens(data.access_token, data.refresh_token);
      await useAuth.getState().adoptUser(data.user);
      onDone();
    } catch (err) {
      setError(friendlyError(err, t, 'register'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell onBack={onBack}>
      <Text style={s.title}>{t('createPassword.title')}</Text>
      <Text style={s.desc}>{t('createPassword.desc')}</Text>

      {error && (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}

      <Text style={s.label}>{t('login.passwordLabel')}</Text>
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
        {loading ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={s.submitBtnText}>{t('createPassword.submitButton')}</Text>}
      </TouchableOpacity>
    </AuthShell>
  );
};
