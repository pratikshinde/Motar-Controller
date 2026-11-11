import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { cardShadow, colors, radius, space } from '@/shared/theme';
import { useDirection } from '@/shared/i18n/useDirection';
import { AJANTA_PAGE, AjantaLogo, AjantaScene } from '@/shared/ui/AjantaScreen';
import { brand } from '@/config/brand';
import { rgba } from '@/shared/theme/color';
import { scene } from '@/shared/theme/scene';

interface AuthShellProps {
  onBack?: () => void;
  showLogo?: boolean;
  rightAction?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Ajanta's frame for every sign-in screen: the same painted farm and sky as the other Ajanta pages, the drop-and-leaf mark with the
 * brand name, and the form on a white card that rises over the edge of the banner.
 */
export const AuthShellAjanta: React.FC<AuthShellProps> = ({ onBack, rightAction, children }) => {
  const { flip } = useDirection();
  // The banner draws under the status bar (Ajanta is an Android app: the bar's height is known).
  const top = Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0;
  const tagline = brand.appName.replace(new RegExp(`^${brand.shortName}\\s*`, 'i'), '').trim();

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={[styles.banner, { paddingTop: top + 8 }]}>
            <AjantaScene pump={false} />
            <View style={styles.topRow}>
              {onBack ? (
                <TouchableOpacity
                  onPress={onBack}
                  style={styles.backBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Back"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <ChevronLeft size={28} color="#FFFFFF" style={flip} />
                </TouchableOpacity>
              ) : (
                <View style={styles.backBtn} />
              )}
              {rightAction ?? <View />}
            </View>
            <View style={styles.brandBlock}>
              <AjantaLogo size={52} />
              <Text style={styles.wordmark}>{brand.shortName}</Text>
              {tagline ? <Text style={styles.tagline}>{tagline}</Text> : null}
            </View>
            <View style={styles.edge} />
          </View>

          <View style={styles.card}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: AJANTA_PAGE },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingBottom: space.xl },
  banner: { backgroundColor: scene.banner, overflow: 'hidden' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  brandBlock: { alignItems: 'center', paddingTop: 4, paddingBottom: 30, gap: 2 },
  wordmark: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 3,
    marginTop: 6,
    textShadowColor: rgba(scene.titleShadow, 0.4),
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 1 },
  },
  tagline: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', opacity: 0.95 },
  edge: { height: 16, backgroundColor: AJANTA_PAGE, borderTopLeftRadius: 18, borderTopRightRadius: 18, position: 'absolute', bottom: 0, start: 0, end: 0 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.xl,
    marginHorizontal: 16,
    marginTop: -6,
    ...(cardShadow as object),
  },
});
