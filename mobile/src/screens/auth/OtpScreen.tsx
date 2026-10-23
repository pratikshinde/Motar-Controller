import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, font, radius, space } from '@/shared/theme';
import { friendlyError, cooldownSecondsFrom } from '@/shared/i18n/errors';
import { confirmPhoneVerification, sendPhoneVerification } from '@/api/phoneVerification';
import { useAuthFlow } from '@/state/authFlow';
import { AuthShell, authStyles as s } from './AuthShell';

interface OtpScreenProps {
  onBack: () => void;
  onVerified: () => void;
}

const CODE_LEN = 6;
const RESEND_SECONDS = 30;

export const OtpScreen: React.FC<OtpScreenProps> = ({ onBack, onVerified }) => {
  const { t } = useTranslation();
  const { phone, purpose, devOtp } = useAuthFlow();
  const [digits, setDigits] = useState<string[]>(Array(CODE_LEN).fill(''));
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);
  const inputs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const code = digits.join('');

  const setDigit = (i: number, val: string) => {
    const v = val.replace(/\D/g, '').slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });
    if (v && i < CODE_LEN - 1) inputs.current[i + 1]?.focus();
  };

  const onKeyPress = (i: number, key: string) => {
    if (key === 'Backspace' && !digits[i] && i > 0) inputs.current[i - 1]?.focus();
  };

  const handleVerify = async (codeOverride?: string) => {
    const value = codeOverride ?? code;
    setError(null);
    if (value.length !== CODE_LEN) return setError(t('otp.incompleteCode'));
    setLoading(true);
    try {
      const res = await confirmPhoneVerification(phone, purpose, value);
      useAuthFlow.getState().setVerificationToken(res.verification_token);
      onVerified();
    } catch (err) {
      setError(friendlyError(err, t, 'load'));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError(null);
    setResending(true);
    try {
      const res = await sendPhoneVerification(phone, purpose);
      useAuthFlow.getState().startVerification(purpose, phone, res.dev_otp ?? null);
      setCooldown(RESEND_SECONDS);
      setDigits(Array(CODE_LEN).fill(''));
      inputs.current[0]?.focus();
    } catch (err) {
      const wait = cooldownSecondsFrom(err);
      if (wait) setCooldown(wait);
      setError(friendlyError(err, t, 'load'));
    } finally {
      setResending(false);
    }
  };

  const autoFill = () => {
    if (!devOtp) return;
    const next = devOtp.split('').slice(0, CODE_LEN);
    setDigits(next);
    void handleVerify(devOtp);
  };

  const mm = String(Math.floor(cooldown / 60)).padStart(2, '0');
  const ss = String(cooldown % 60).padStart(2, '0');

  return (
    <AuthShell onBack={onBack}>
      <Text style={s.title}>{t('otp.title')}</Text>
      <Text style={s.desc}>
        {t('otp.desc')} <Text style={{ fontWeight: '800', color: colors.text }}>{phone}</Text> {t('otp.onWhatsapp')}
      </Text>

      {devOtp && (
        <TouchableOpacity style={styles.devBanner} onPress={autoFill} accessibilityRole="button">
          <Text style={styles.devBannerText}>
            {t('otp.testOtpNotice')}: <Text style={{ fontWeight: '900' }}>{devOtp}</Text>
          </Text>
          <Text style={styles.devBannerLink}>{t('otp.autoFill')}</Text>
        </TouchableOpacity>
      )}

      {error && (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}

      <View style={styles.otpRow}>
        {digits.map((d, i) => (
          <TextInput
            key={i}
            ref={(el) => {
              inputs.current[i] = el;
            }}
            style={[styles.otpBox, d ? styles.otpBoxFilled : null]}
            value={d}
            onChangeText={(v) => setDigit(i, v)}
            onKeyPress={({ nativeEvent }) => onKeyPress(i, nativeEvent.key)}
            keyboardType="number-pad"
            maxLength={1}
            textAlign="center"
          />
        ))}
      </View>

      <View style={styles.resendRow}>
        <Text style={s.footerText}>{t('otp.resendPrompt')}</Text>
        {cooldown > 0 ? (
          <Text style={styles.timer}>
            {t('otp.resendIn')} {mm}:{ss}
          </Text>
        ) : (
          <TouchableOpacity onPress={handleResend} disabled={resending}>
            <Text style={s.footerLink}>{resending ? '…' : t('otp.resendButton')}</Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity
        style={[s.submitBtn, (loading || code.length !== CODE_LEN) && { opacity: 0.6 }]}
        onPress={() => handleVerify()}
        disabled={loading || code.length !== CODE_LEN}
        activeOpacity={0.85}
      >
        {loading ? (
          <ActivityIndicator color={colors.textOnPrimary} />
        ) : (
          <Text style={s.submitBtnText}>{t('otp.verifyButton')}</Text>
        )}
      </TouchableOpacity>
    </AuthShell>
  );
};

const styles = StyleSheet.create({
  devBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: '#FFE8B3',
    borderRadius: radius.md,
    padding: 12,
    marginBottom: space.md,
  },
  devBannerText: { color: colors.warn, fontSize: 13, flexShrink: 1 },
  devBannerLink: { color: colors.warn, fontWeight: '800', fontSize: 13 },
  otpRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: space.sm },
  otpBox: {
    flex: 1,
    minWidth: 0,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    fontSize: font.title,
    fontWeight: '800',
    color: colors.text,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null),
  },
  otpBoxFilled: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  resendRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: space.lg },
  timer: { color: colors.textFaint, fontSize: font.body, fontWeight: '700' },
});
