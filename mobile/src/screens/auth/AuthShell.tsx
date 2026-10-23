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
import { Droplets, ChevronLeft } from 'lucide-react-native';
import { colors, font, radius, space, cardShadow } from '@/shared/theme';
import { useDirection } from '@/shared/i18n/useDirection';

interface AuthShellProps {
  onBack?: () => void;
  showLogo?: boolean;
  rightAction?: React.ReactNode;
  children: React.ReactNode;
}

/** Shared header (back button + AJANTA brand mark) and scroll frame for every auth-flow screen. */
export const AuthShell: React.FC<AuthShellProps> = ({ onBack, showLogo = true, rightAction, children }) => {
  const { flip } = useDirection();
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {onBack ? (
            <TouchableOpacity
              onPress={onBack}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <ChevronLeft size={26} color={colors.text} style={flip} />
            </TouchableOpacity>
          ) : null}

          {showLogo && (
            <View style={styles.brandRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={styles.logoCircle}>
                  <Droplets size={26} color={colors.textOnPrimary} />
                </View>
                <View>
                  <Text style={styles.brandTitle}>AJANTA</Text>
                  <Text style={styles.brandSubtitle}>AJANTA PUMP CONTROLLER</Text>
                </View>
              </View>
              {rightAction}
            </View>
          )}

          <View style={styles.card}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, padding: space.lg, paddingTop: space.xl },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.xl },
  logoCircle: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTitle: { color: colors.text, fontSize: font.title, fontWeight: '900', letterSpacing: 1 },
  brandSubtitle: { color: colors.textFaint, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.xl,
    ...(cardShadow as object),
  },
});

export const authStyles = StyleSheet.create({
  title: { color: colors.text, fontSize: font.headline, fontWeight: '800' },
  desc: { color: colors.textMuted, fontSize: font.body, marginTop: 6, marginBottom: space.lg, lineHeight: 22 },
  label: { color: colors.text, fontSize: font.body, fontWeight: '700', marginTop: space.md, marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
  },
  flagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingEnd: 10,
    marginEnd: 10,
    borderEndWidth: 1.5,
    borderEndColor: colors.border,
    height: 34,
  },
  flagText: { fontSize: 15 },
  ccText: { color: colors.text, fontSize: font.bodyLg, fontWeight: '700' },
  input: { flex: 1, color: colors.text, fontSize: font.bodyLg, height: 56 },
  inputIcon: { marginEnd: 10 },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    minHeight: 56,
    marginTop: space.xl,
  },
  submitBtnText: { color: colors.textOnPrimary, fontSize: font.title, fontWeight: '800' },
  footerRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: space.lg, flexWrap: 'wrap' },
  footerText: { color: colors.textMuted, fontSize: font.body },
  footerLink: { color: colors.primaryDark, fontSize: font.body, fontWeight: '800' },
  errorBox: {
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: '#F3B9B5',
    borderRadius: radius.md,
    padding: 12,
    marginBottom: space.md,
  },
  errorText: { color: colors.danger, fontSize: 14, fontWeight: '700' },
});
