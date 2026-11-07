import React, { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ArrowRight, Phone, QrCode, RefreshCw } from 'lucide-react-native';
import { useAuth } from '@/state/auth';
import { isClaimQr } from '@/features/claim/qr';
import { colors, radius, space } from '@/shared/theme';
import { normalizePhone } from '@/shared/phone';
import { friendlyError } from '@/shared/i18n/errors';
import { AuthShell, authStyles as s } from './AuthShell';

interface ScanQrScreenProps {
  onBack: () => void;
  onSignedIn: () => void;
}

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

  return (
    <AuthShell onBack={onBack}>
      <Text style={s.title}>{t('claim.title')}</Text>
      <Text style={s.desc}>{qr ? t('claim.numberHelp') : t('claim.help')}</Text>

      {error && (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}

      {!qr ? (
        permission?.granted ? (
          <View style={styles.cameraBox} testID="scan-camera">
            <CameraView
              style={styles.camera}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={onScanned}
            />
          </View>
        ) : (
          <View style={styles.permissionBox}>
            <QrCode size={48} color={colors.primary} />
            <Text style={styles.permissionText}>{t('claim.allowCamera')}</Text>
            <TouchableOpacity style={s.submitBtn} onPress={() => requestPermission()} activeOpacity={0.85}>
              <Text style={s.submitBtnText}>{t('claim.allowCameraButton')}</Text>
            </TouchableOpacity>
          </View>
        )
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

          <TouchableOpacity
            style={[s.submitBtn, loading && { opacity: 0.7 }]}
            onPress={submit}
            disabled={loading}
            activeOpacity={0.85}
          >
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
    </AuthShell>
  );
};

const styles = StyleSheet.create({
  cameraBox: {
    height: 320,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: '#000',
    marginTop: space.md,
  },
  camera: { flex: 1 },
  permissionBox: { alignItems: 'center', gap: space.md, marginTop: space.lg },
  permissionText: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  scanAgain: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: space.lg },
});
