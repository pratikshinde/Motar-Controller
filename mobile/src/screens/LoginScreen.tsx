import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Phone,
  KeyRound,
  ArrowRight,
  Eye,
  EyeOff,
  ShieldCheck,
  Globe,
  Sparkles,
  MessageSquare,
  RefreshCw,
} from 'lucide-react-native';
import { useAuth } from '@/state/auth';
import { colors, radius, space } from '@/shared/theme';
import { normalizePhone } from '@/shared/phone';
import { friendlyError } from '../shared/i18n/errors';
import { AuthShell, authStyles as s } from './auth/AuthShell';
import i18n, { LANGUAGES } from '@/shared/i18n';

interface LoginScreenProps {
  onLoginSuccess: () => void;
  onForgotPassword: () => void;
  onRegister: () => void;
  onChangeLanguage?: () => void;
}

// Shortcuts for a developer's machine only: the seeded demo accounts and their published password. Empty in a release
// build (`__DEV__` is false), so neither the accounts nor the password ship, and the "Quick Test Accounts" bar is not drawn.
const DEMO_ACCOUNTS = __DEV__
  ? [
      { label: 'Farmer', role: 'Customer', phone: '9999900006', pass: 'Admin@123', icon: '👨‍🌾' },
      { label: 'Dealer', role: 'Installer', phone: '9999900004', pass: 'Admin@123', icon: '🏪' },
      { label: 'Support', role: 'Engineer', phone: '9999900005', pass: 'Admin@123', icon: '🛡️' },
      { label: 'Manufacturer', role: 'OEM', phone: '9999900002', pass: 'Admin@123', icon: '🏭' },
      { label: 'Super Admin', role: 'Admin (MFA)', phone: '9999900001', pass: 'Admin@123', icon: '👑' },
      { label: 'Swati Dealer', role: 'Other brand', phone: '9999900014', pass: 'Admin@123', icon: '🏬' },
      { label: 'Two brands', role: 'Farmer', phone: '9999900019', pass: 'Admin@123', icon: '🌾' },
    ]
  : [];

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onLoginSuccess,
  onForgotPassword,
  onRegister,
  onChangeLanguage,
}) => {
  const { t } = useTranslation();
  const expired = useAuth((st) => st.expired);

  const [mode, setMode] = useState<'password' | 'otp'>('password');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // OTP flow state
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // MFA 2FA state
  const [mfaPending, setMfaPending] = useState(false);
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(expired ? t('errors.sessionExpired') : null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleSelectDemo = (acc: typeof DEMO_ACCOUNTS[number]) => {
    setPhone(acc.phone);
    if (mode === 'password') setPassword(acc.pass);
    setError(null);
    if (otpSent) {
      setOtpSent(false);
      setOtpCode('');
    }
  };

  const handlePasswordLogin = async () => {
    setError(null);
    if (!phone.trim()) return setError(t('login.needPhone'));
    if (!password.trim()) return setError(t('login.needPassword'));

    setLoading(true);
    try {
      const res = await useAuth.getState().signIn(normalizePhone(phone), password.trim());
      if (res.mfaRequired && res.tempToken) {
        setMfaPending(true);
        setTempToken(res.tempToken);
        setMfaCode('');
        return;
      }
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

  const handleSendOtp = async () => {
    setError(null);
    if (!phone.trim()) return setError(t('login.needPhone'));
    const clean = normalizePhone(phone);
    setLoading(true);
    try {
      const res = await useAuth.getState().sendOtp(clean);
      setOtpSent(true);
      // The server returns the code only in development mode; never invent one to show.
      setDevOtp(res.dev_otp ?? null);
      setCooldown(30);
    } catch (err: any) {
      setError(err?.response?.data?.detail || friendlyError(err, t, 'login'));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (codeToVerify?: string) => {
    setError(null);
    const targetCode = codeToVerify || otpCode;
    const clean = normalizePhone(phone);
    if (targetCode.trim().length !== 6) return setError(t('otp.incompleteCode', 'Please enter 6-digit verification code.'));

    setLoading(true);
    try {
      const res = await useAuth.getState().signInWithOtp(clean, targetCode.trim());
      if (res.mfaRequired && res.tempToken) {
        setMfaPending(true);
        setTempToken(res.tempToken);
        setMfaCode('');
        return;
      }
      onLoginSuccess();
    } catch (err: any) {
      setError(err?.response?.data?.detail || friendlyError(err, t, 'login'));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyMfa = async (codeToVerify?: string) => {
    setError(null);
    if (!tempToken) return setError('Session expired. Please log in again.');
    const target = codeToVerify || mfaCode;
    if (target.trim().length !== 6) return setError('Please enter 6-digit Authenticator code.');

    setLoading(true);
    try {
      await useAuth.getState().verifyMfa(tempToken, target.trim());
      onLoginSuccess();
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || 'Invalid 2FA code. Please check your Authenticator app.');
    } finally {
      setLoading(false);
    }
  };

  const currentLang = LANGUAGES.find((l) => l.code === i18n.language) || LANGUAGES[0];

  const renderLanguagePill = onChangeLanguage ? (
    <TouchableOpacity
      onPress={onChangeLanguage}
      style={localStyles.langPill}
      accessibilityRole="button"
      accessibilityLabel="Change Language"
    >
      <Globe size={15} color={colors.primaryDark} />
      <Text style={localStyles.langPillText}>{currentLang?.native || 'Language'}</Text>
    </TouchableOpacity>
  ) : null;

  // --- VIEW 1: SUPER ADMIN MFA VERIFICATION SCREEN ---
  if (mfaPending) {
    return (
      <AuthShell rightAction={renderLanguagePill}>
        <View style={localStyles.mfaHeader}>
          <View style={localStyles.mfaIconWrap}>
            <ShieldCheck size={32} color={colors.primary} />
          </View>
          <Text style={s.title}>Two-Factor Security</Text>
          <Text style={s.desc}>
            Super Admin access requires Multi-Factor Authentication (MFA). Enter the 6-digit code from your Authenticator app.
          </Text>
        </View>

        {error && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        {/* Dev OTP quick fill chip - development builds only */}
        {__DEV__ && (
          <TouchableOpacity
            onPress={() => {
              setMfaCode('123456');
              void handleVerifyMfa('123456');
            }}
            style={localStyles.devChip}
            activeOpacity={0.8}
          >
            <Sparkles size={16} color="#0284C7" />
            <Text style={localStyles.devChipText}>Test Code: 123456 (Tap to autofill)</Text>
          </TouchableOpacity>
        )}

        <Text style={s.label}>6-Digit Security Code</Text>
        <View style={s.inputWrap}>
          <ShieldCheck size={20} color={colors.textMuted} style={s.inputIcon} />
          <TextInput
            style={[s.input, { letterSpacing: 6, fontSize: 18, fontWeight: '700' }]}
            value={mfaCode}
            onChangeText={setMfaCode}
            placeholder="000000"
            placeholderTextColor={colors.textFaint}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
          />
        </View>

        <TouchableOpacity
          style={[s.submitBtn, loading && { opacity: 0.7 }]}
          onPress={() => handleVerifyMfa()}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <>
              <Text style={s.submitBtnText}>Verify & Continue</Text>
              <ArrowRight size={20} color={colors.textOnPrimary} />
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => {
            setMfaPending(false);
            setTempToken(null);
            setError(null);
          }}
          style={{ alignSelf: 'center', marginTop: space.lg }}
        >
          <Text style={s.footerLink}>Cancel and return to login</Text>
        </TouchableOpacity>
      </AuthShell>
    );
  }

  // --- VIEW 2: STANDARD LOGIN SCREEN (PASSWORD & OTP TABS) ---
  return (
    <AuthShell rightAction={renderLanguagePill}>
      {/* Mode Switcher Tabs */}
      <View style={localStyles.tabBar}>
        <TouchableOpacity
          style={[localStyles.tabItem, mode === 'password' && localStyles.tabItemActive]}
          onPress={() => {
            setMode('password');
            setError(null);
          }}
          activeOpacity={0.8}
        >
          <KeyRound size={16} color={mode === 'password' ? colors.primaryDark : colors.textMuted} />
          <Text style={[localStyles.tabText, mode === 'password' && localStyles.tabTextActive]}>
            Password
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[localStyles.tabItem, mode === 'otp' && localStyles.tabItemActive]}
          onPress={() => {
            setMode('otp');
            setError(null);
          }}
          activeOpacity={0.8}
        >
          <MessageSquare size={16} color={mode === 'otp' ? colors.primaryDark : colors.textMuted} />
          <Text style={[localStyles.tabText, mode === 'otp' && localStyles.tabTextActive]}>
            WhatsApp / SMS OTP
          </Text>
        </TouchableOpacity>
      </View>

      {/* Quick Test Accounts Bar - development builds only */}
      {DEMO_ACCOUNTS.length > 0 && (
        <View style={localStyles.demoSection}>
          <View style={localStyles.demoTitleRow}>
            <Sparkles size={14} color={colors.primaryDark} />
            <Text style={localStyles.demoHeading}>Quick Test Accounts</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={localStyles.demoScroll}
          >
            {DEMO_ACCOUNTS.map((acc) => {
              const isSelected = phone === acc.phone;
              return (
                <TouchableOpacity
                  key={acc.phone}
                  style={[localStyles.demoChip, isSelected && localStyles.demoChipSelected]}
                  onPress={() => handleSelectDemo(acc)}
                  activeOpacity={0.75}
                >
                  <Text style={localStyles.demoIcon}>{acc.icon}</Text>
                  <View>
                    <Text style={[localStyles.demoRole, isSelected && localStyles.demoRoleSelected]}>
                      {acc.label}
                    </Text>
                    <Text style={localStyles.demoPhone}>{acc.phone}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      <Text style={s.title}>{t('login.welcomeBack')}</Text>
      <Text style={s.desc}>
        {mode === 'password' ? t('login.welcomeBackDesc') : 'Sign in securely with a one-time verification code.'}
      </Text>

      {error && (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}

      {/* Mobile Number Field (Shared) */}
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
          onChangeText={(v) => {
            setPhone(v);
            if (otpSent) setOtpSent(false);
          }}
          placeholder={t('login.mobilePlaceholder')}
          placeholderTextColor={colors.textFaint}
          keyboardType="phone-pad"
          maxLength={10}
        />
      </View>

      {/* MODE 1: PASSWORD LOGIN */}
      {mode === 'password' && (
        <>
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
            onPress={handlePasswordLogin}
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
        </>
      )}

      {/* MODE 2: OTP LOGIN */}
      {mode === 'otp' && (
        <>
          {!otpSent ? (
            <TouchableOpacity
              style={[s.submitBtn, { marginTop: space.lg }, loading && { opacity: 0.7 }]}
              onPress={handleSendOtp}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color={colors.textOnPrimary} />
              ) : (
                <>
                  <Text style={s.submitBtnText}>Send Verification Code</Text>
                  <ArrowRight size={20} color={colors.textOnPrimary} />
                </>
              )}
            </TouchableOpacity>
          ) : (
            <>
              {devOtp && (
                <TouchableOpacity
                  onPress={() => {
                    setOtpCode(devOtp);
                    void handleVerifyOtp(devOtp);
                  }}
                  style={[localStyles.devChip, { marginTop: space.md }]}
                  activeOpacity={0.8}
                >
                  <Sparkles size={16} color="#0284C7" />
                  <Text style={localStyles.devChipText}>Dev OTP: {devOtp} (Tap to auto-fill)</Text>
                </TouchableOpacity>
              )}

              <Text style={s.label}>6-Digit OTP Code</Text>
              <View style={s.inputWrap}>
                <MessageSquare size={20} color={colors.textMuted} style={s.inputIcon} />
                <TextInput
                  style={[s.input, { letterSpacing: 4, fontWeight: '700' }]}
                  value={otpCode}
                  onChangeText={setOtpCode}
                  placeholder="123456"
                  placeholderTextColor={colors.textFaint}
                  keyboardType="number-pad"
                  maxLength={6}
                />
              </View>

              <TouchableOpacity
                style={[s.submitBtn, loading && { opacity: 0.7 }]}
                onPress={() => handleVerifyOtp()}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator color={colors.textOnPrimary} />
                ) : (
                  <>
                    <Text style={s.submitBtnText}>Verify & Sign In</Text>
                    <ArrowRight size={20} color={colors.textOnPrimary} />
                  </>
                )}
              </TouchableOpacity>

              <View style={localStyles.resendRow}>
                {cooldown > 0 ? (
                  <Text style={localStyles.cooldownText}>
                    Resend code in {cooldown}s
                  </Text>
                ) : (
                  <TouchableOpacity
                    onPress={handleSendOtp}
                    style={localStyles.resendBtn}
                    disabled={loading}
                  >
                    <RefreshCw size={14} color={colors.primaryDark} />
                    <Text style={localStyles.resendBtnText}>Resend OTP</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={() => {
                    setOtpSent(false);
                    setOtpCode('');
                  }}
                >
                  <Text style={s.footerLink}>Change number</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </>
      )}

      {/* Footer Register Link */}
      <View style={s.footerRow}>
        <Text style={s.footerText}>{t('login.newHere')}</Text>
        <TouchableOpacity onPress={onRegister}>
          <Text style={s.footerLink}>{t('login.createLink')}</Text>
        </TouchableOpacity>
      </View>
    </AuthShell>
  );
};

const localStyles = StyleSheet.create({
  langPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  langPillText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: '700',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: 4,
    marginBottom: space.lg,
    gap: 4,
  },
  tabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.sm,
  },
  tabItemActive: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  tabTextActive: {
    color: colors.primaryDark,
    fontWeight: '700',
  },
  demoSection: {
    marginBottom: space.lg,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  demoTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  demoHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  demoScroll: {
    gap: 8,
    paddingVertical: 4,
  },
  demoChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  demoChipSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  demoIcon: {
    fontSize: 18,
  },
  demoRole: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  demoRoleSelected: {
    color: colors.primaryDark,
  },
  demoPhone: {
    fontSize: 10,
    color: colors.textFaint,
    fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }),
  },
  devChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: space.md,
  },
  devChipText: {
    color: '#0369A1',
    fontSize: 12,
    fontWeight: '600',
  },
  mfaHeader: {
    alignItems: 'center',
    textAlign: 'center',
    marginBottom: space.lg,
  },
  mfaIconWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    borderWidth: 1.5,
    borderColor: colors.primaryBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  resendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.md,
  },
  cooldownText: {
    fontSize: 13,
    color: colors.textFaint,
  },
  resendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  resendBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primaryDark,
  },
});
