import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { ChevronLeft } from 'lucide-react-native';
import { radius, space, cardShadow } from '@/shared/theme';
import { useDirection } from '@/shared/i18n/useDirection';
import { useTranslation } from 'react-i18next';
import { SwatiLogo } from '@/shared/ui/SwatiLogo';

interface AuthShellProps {
  onBack?: () => void;
  showLogo?: boolean;
  rightAction?: React.ReactNode;
  children: React.ReactNode;
}

export const AuthShellSwati: React.FC<AuthShellProps> = ({ onBack, showLogo = true, rightAction, children }) => {
  const { flip } = useDirection();
  const { t } = useTranslation();
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Decorative Agricultural Landscape at bottom */}
      <View style={styles.bottomLandscape} pointerEvents="none">
        <Svg width="100%" height="100%" viewBox="0 0 360 120" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="farmHills" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#86EFAC" />
              <Stop offset="100%" stopColor="#15803D" />
            </LinearGradient>
            <LinearGradient id="farmHillsDistant" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#BBF7D0" />
              <Stop offset="100%" stopColor="#22C55E" />
            </LinearGradient>
          </Defs>
          <Path d="M0 60 Q90 20 180 40 T360 30 L360 120 L0 120 Z" fill="url(#farmHillsDistant)" opacity={0.6} />
          <Path d="M0 75 Q120 40 240 65 T360 50 L360 120 L0 120 Z" fill="url(#farmHills)" opacity={0.85} />
        </Svg>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.topRow}>
            {onBack ? (
              <TouchableOpacity
                onPress={onBack}
                style={styles.backBtn}
                accessibilityRole="button"
                accessibilityLabel={t('common.back')}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <ChevronLeft size={26} color="#0F172A" style={flip} />
              </TouchableOpacity>
            ) : <View style={{ width: 44 }} />}
            {rightAction}
          </View>

          {showLogo && (
            <View style={styles.brandHero}>
              <SwatiLogo size={62} />
              <Text style={styles.brandTitle}>SWATI</Text>
              <Text style={styles.brandSubtitle}>{t('splash.tagline')}</Text>
            </View>
          )}

          <View style={styles.card}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8FAFC' },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, padding: space.lg, paddingTop: space.md, paddingBottom: 100 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandHero: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  brandTitle: {
    color: '#0F172A',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 2,
    marginTop: 8,
  },
  brandSubtitle: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    padding: space.xl,
    ...(cardShadow as object),
  },
  bottomLandscape: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 100,
    zIndex: -1,
  },
});

export const authStylesSwati = StyleSheet.create({
  title: { color: '#0F172A', fontSize: 20, fontWeight: '800' },
  desc: { color: '#475569', fontSize: 14, marginTop: 4, marginBottom: space.md, lineHeight: 20 },
  label: { color: '#334155', fontSize: 14, fontWeight: '700', marginTop: space.sm, marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    minHeight: 52,
  },
  flagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingEnd: 10,
    marginEnd: 10,
    borderEndWidth: 1.5,
    borderEndColor: '#E2E8F0',
    height: 32,
  },
  flagText: { fontSize: 16 },
  ccText: { color: '#0F172A', fontSize: 15, fontWeight: '800' },
  input: { flex: 1, color: '#0F172A', fontSize: 16, height: 50 },
  inputIcon: { marginEnd: 10 },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#1565C0',
    borderRadius: 28,
    minHeight: 52,
    marginTop: space.lg,
    elevation: 3,
    shadowColor: '#1565C0',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  submitBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  footerRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: space.lg, flexWrap: 'wrap' },
  footerText: { color: '#64748B', fontSize: 14 },
  footerLink: { color: '#1565C0', fontSize: 14, fontWeight: '800' },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 12,
    padding: 12,
    marginBottom: space.md,
  },
  errorText: { color: '#DC2626', fontSize: 13, fontWeight: '700' },
});
