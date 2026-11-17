import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ArrowRight, Camera, Lightbulb, Phone, RefreshCw, ScanLine } from 'lucide-react-native';
import { useAuth } from '@/state/auth';
import { isClaimQr } from '@/features/claim/qr';
import { colors, space } from '@/shared/theme';
import { normalizePhone } from '@/shared/phone';
import { friendlyError } from '@/shared/i18n/errors';
import { AuthShell, authStyles as s } from './AuthShell';

interface ScanQrScreenProps {
  onBack: () => void;
  onSignedIn: () => void;
}

/** Four white corners and a purple line that sweeps up and down: where to hold the QR code. */
const ScanFrame: React.FC = () => {
  const [sweep] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        Animated.timing(sweep, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);
  const top = sweep.interpolate({ inputRange: [0, 1], outputRange: ['8%', '88%'] });
  return (
    <View style={styles.frameWrap} pointerEvents="none">
      <View style={styles.frame}>
        <View style={[styles.corner, styles.tl]} />
        <View style={[styles.corner, styles.tr]} />
        <View style={[styles.corner, styles.bl]} />
        <View style={[styles.corner, styles.br]} />
        <Animated.View style={[styles.sweepLine, { top }]} />
      </View>
    </View>
  );
};

/**
 * The farmer's first sign-in: scan the QR code the dealer printed, then type the mobile number the dealer registered. No OTP.
 * The server checks the QR (one use, 30 days) and the number together.
 */
export const ScanQrScreen: React.FC<ScanQrScreenProps> = ({ onBack, onSignedIn }) => {
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const [qr, setQr] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notNow, setNotNow] = useState(false);
  const lastWrongScan = useRef(0);

  const onScanned = ({ data }: { data: string }) => {
    if (qr) return;
    if (isClaimQr(data)) {
      setError(null);
      setQr(data.trim());
      return;
    }
    // The camera reports the same code many times a second: say it once in a while, not on every frame.
    const now = Date.now();
    if (now - lastWrongScan.current > 3000) {
      lastWrongScan.current = now;
      setError(t('claim.notOurQr'));
    }
  };

  const submit = async () => {
    setError(null);
    if (!phone.trim()) return setError(t('login.needPhone'));
    if (!qr) return;
    setLoading(true);
    try {
      const res = await useAuth.getState().signInWithQr(qr, normalizePhone(phone));
      if (res.mfaRequired) return setError(t('errors.mfaUnsupported'));
      onSignedIn();
    } catch (err: any) {
      setError(err?.response?.data?.detail || friendlyError(err, t, 'login'));
    } finally {
      setLoading(false);
    }
  };

  const cameraBlocked = !qr && !!permission && !permission.granted;

  return (
    <AuthShell onBack={onBack}>
      <View style={styles.iconTile}>
        <ScanLine size={34} color={colors.primary} />
      </View>
      <Text style={[s.title, styles.center]}>{t('claim.title')}</Text>
      <Text style={[s.desc, styles.center]}>{qr ? t('claim.numberHelp') : t('claim.help')}</Text>

      {error && (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}

      {!qr ? (
        <>
          <View style={styles.cameraBox} testID={permission?.granted ? 'scan-camera' : undefined}>
            {permission?.granted ? (
              <CameraView style={styles.camera} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScanned} />
            ) : null}
            <ScanFrame />
            {cameraBlocked && notNow ? (
              <View style={styles.blockedOverlay}>
                <Text style={styles.blockedText}>{t('claim.allowCamera')}</Text>
                <TouchableOpacity style={styles.smallBtn} onPress={() => requestPermission()} activeOpacity={0.85}>
                  <Camera size={18} color="#FFFFFF" />
                  <Text style={styles.smallBtnText}>{t('claim.allowCameraButton')}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
          <View style={styles.hint}>
            <Lightbulb size={16} color={colors.primary} />
            <Text style={styles.hintText}>{t('claim.scanHint')}</Text>
          </View>
        </>
      ) : (
        <>
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
              autoFocus
            />
          </View>

          <TouchableOpacity style={[s.submitBtn, loading && { opacity: 0.7 }]} onPress={submit} disabled={loading} activeOpacity={0.85}>
            {loading ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <>
                <Text style={s.submitBtnText}>{t('claim.continue')}</Text>
                <ArrowRight size={20} color={colors.textOnPrimary} />
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              setQr(null);
              setError(null);
            }}
            style={styles.scanAgain}
          >
            <RefreshCw size={14} color={colors.primaryDark} />
            <Text style={s.footerLink}>{t('claim.scanAgain')}</Text>
          </TouchableOpacity>
        </>
      )}

      <Modal visible={cameraBlocked && !notNow} transparent animationType="fade" onRequestClose={() => setNotNow(true)} statusBarTranslucent>
        <View style={styles.dim}>
          <View style={styles.dialog} accessibilityViewIsModal>
            <View style={styles.dialogIcon}>
              <Camera size={36} color={colors.primary} />
              <Svg width={26} height={26} viewBox="0 0 26 26" style={styles.sparkle}>
                <Path d="M6 4 L10 10" stroke={colors.primary} strokeWidth={2.4} strokeLinecap="round" />
                <Path d="M16 2 L16 8" stroke={colors.primary} strokeWidth={2.4} strokeLinecap="round" />
                <Path d="M22 10 L17 12" stroke={colors.primary} strokeWidth={2.4} strokeLinecap="round" />
              </Svg>
            </View>
            <Text style={styles.dialogTitle}>{t('claim.cameraTitle')}</Text>
            <Text style={styles.dialogText}>{t('claim.allowCamera')}</Text>
            <TouchableOpacity style={styles.allowBtn} onPress={() => requestPermission()} activeOpacity={0.85} accessibilityRole="button">
              <Camera size={22} color="#FFFFFF" />
              <Text style={styles.allowText}>{t('claim.allowCameraButton')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.notNowBtn} onPress={() => setNotNow(true)} activeOpacity={0.85} accessibilityRole="button">
              <Text style={styles.notNowText}>{t('claim.notNow')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </AuthShell>
  );
};

const CORNER = 34;
const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  iconTile: {
    alignSelf: 'center',
    width: 68,
    height: 68,
    borderRadius: 22,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  cameraBox: {
    height: 250,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#6E6B73',
    marginTop: space.sm,
  },
  camera: { flex: 1 },
  frameWrap: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' },
  frame: { width: 150, height: 150 },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: '#FFFFFF' },
  tl: { top: 0, start: 0, borderTopWidth: 4, borderStartWidth: 4, borderTopStartRadius: 10 },
  tr: { top: 0, end: 0, borderTopWidth: 4, borderEndWidth: 4, borderTopEndRadius: 10 },
  bl: { bottom: 0, start: 0, borderBottomWidth: 4, borderStartWidth: 4, borderBottomStartRadius: 10 },
  br: { bottom: 0, end: 0, borderBottomWidth: 4, borderEndWidth: 4, borderBottomEndRadius: 10 },
  sweepLine: { position: 'absolute', start: -6, end: -6, height: 3, borderRadius: 2, backgroundColor: '#A98BFF', shadowColor: '#A98BFF', shadowOpacity: 0.9, shadowRadius: 8, elevation: 4 },
  blockedOverlay: { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: 'rgba(40,33,59,0.78)', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 20 },
  blockedText: { color: '#FFFFFF', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 11 },
  smallBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  hint: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
    marginTop: space.md,
  },
  hintText: { color: colors.primaryDark, fontSize: 12.5, fontWeight: '700', flexShrink: 1 },
  scanAgain: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: space.lg },

  dim: { flex: 1, backgroundColor: 'rgba(40,20,85,0.62)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { width: '100%', maxWidth: 380, backgroundColor: '#FFFFFF', borderRadius: 30, padding: 24, alignItems: 'center' },
  dialogIcon: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  sparkle: { position: 'absolute', top: -8, end: -18 },
  dialogTitle: { color: colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  dialogText: { color: colors.textMuted, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 8, marginBottom: 20 },
  allowBtn: { width: '100%', height: 56, borderRadius: 999, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  allowText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  notNowBtn: { width: '100%', height: 54, borderRadius: 999, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  notNowText: { color: colors.primaryDark, fontSize: 16, fontWeight: '800' },
});
