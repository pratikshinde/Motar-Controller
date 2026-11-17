import React, { useEffect } from 'react';
import { ActivityIndicator, Platform, StatusBar, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { ShieldCheck } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { brand } from '../config/brand';
import { tracking } from '../shared/i18n/languages';
import { AJANTA_PAGE, AjantaFullLogo, AjantaHeaderBackdrop, AjantaScene } from '../shared/ui/AjantaScreen';

import { colors } from '@/shared/theme';
import { rgba } from '@/shared/theme/color';
import { scene } from '@/shared/theme/scene';
interface SplashScreenProps {
  onFinish: () => void;
}

/**
 * Ajanta's splash: the purple gradient with the logo card, the name and the tagline, a farm with a pump pouring water at the foot of
 * it, then the page colour with the loader and the one-line promise.
 */
export const SplashScreenAjanta: React.FC<SplashScreenProps> = ({ onFinish }) => {
  const { t, i18n } = useTranslation();
  const top = Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0;
  useEffect(() => {
    const timer = setTimeout(onFinish, 2200);
    return () => clearTimeout(timer);
  }, [onFinish]);

  return (
    <View style={styles.root}>
      <View style={styles.banner}>
        <AjantaHeaderBackdrop />
        <View style={styles.farm}>
          <AjantaScene pump sky={false} trees />
        </View>
        <View style={[styles.brandBox, { paddingTop: top + 8 }]}>
          <View style={styles.logoCard}>
            <AjantaFullLogo width={236} />
          </View>
          <Text style={[styles.title, tracking(i18n.language, 2)]} numberOfLines={1} adjustsFontSizeToFit>
            {brand.titleLine1}
          </Text>
          <Text style={[styles.subtitle, tracking(i18n.language, 3)]}>{brand.titleLine2}</Text>
          <Text style={styles.tagline}>{t('splash.tagline')}</Text>
          <Svg width={150} height={10} viewBox="0 0 150 10" style={styles.swoosh}>
            <Path d="M2 7 Q75 0 148 5" stroke="#FFFFFF" strokeWidth={1.6} strokeLinecap="round" fill="none" opacity={0.7} />
          </Svg>
        </View>
        <View style={styles.edge} />
      </View>

      <View style={styles.bottom}>
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loaderText}>{t('splash.starting')}</Text>
        </View>
        <View style={styles.footerRow}>
          <View style={styles.rule} />
          <ShieldCheck size={16} color={colors.textMuted} />
          <Text style={styles.footer}>{t('splash.footer')}</Text>
          <View style={styles.rule} />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: AJANTA_PAGE },
  banner: { flex: 1.5, backgroundColor: scene.banner, overflow: 'hidden', alignItems: 'center' },
  // The farm keeps the 400 : 190 shape of the painting and sits on the bottom of the banner.
  farm: { position: 'absolute', start: 0, end: 0, bottom: 0, aspectRatio: 400 / 190 },
  brandBox: { alignItems: 'center', paddingHorizontal: 24, width: '100%', marginTop: 28 },
  logoCard: {
    width: 280,
    height: 104,
    borderRadius: 26,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.55)',
    elevation: 6,
    shadowColor: colors.shadowTint,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  },
  title: {
    color: '#FFFFFF',
    fontSize: 33,
    fontWeight: '900',
    textAlign: 'center',
    textShadowColor: rgba(scene.titleShadow, 0.4),
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 1 },
  },
  subtitle: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 8,
    opacity: 0.95,
  },
  tagline: { color: '#FFFFFF', fontSize: 19, fontStyle: 'italic', textAlign: 'center', marginTop: 20, opacity: 0.95 },
  swoosh: { marginTop: 4 },
  edge: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: 0,
    height: 22,
    backgroundColor: AJANTA_PAGE,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  bottom: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, paddingBottom: 28, paddingHorizontal: 24 },
  loader: { alignItems: 'center', gap: 10 },
  loaderText: { color: colors.primaryDark, fontSize: 16, fontWeight: '800' },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%' },
  rule: { flex: 1, height: 1, backgroundColor: colors.borderStrong },
  footer: { color: colors.textMuted, fontSize: 13, letterSpacing: 0.3, textAlign: 'center' },
});
