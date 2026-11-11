import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { brand } from '../config/brand';
import { tracking } from '../shared/i18n/languages';
import { AJANTA_PAGE, AjantaLogo, AjantaScene } from '../shared/ui/AjantaScreen';

import { colors } from '@/shared/theme';
import { rgba } from '@/shared/theme/color';
import { scene } from '@/shared/theme/scene';
interface SplashScreenProps {
  onFinish: () => void;
}

/** Ajanta's splash: the same blue farm banner as the Home, Timer and More pages, then the brand and a loader on the page colour. */
export const SplashScreenAjanta: React.FC<SplashScreenProps> = ({ onFinish }) => {
  const { t, i18n } = useTranslation();
  useEffect(() => {
    const timer = setTimeout(onFinish, 2200);
    return () => clearTimeout(timer);
  }, [onFinish]);

  return (
    <View style={styles.root}>
      <View style={styles.banner}>
        <AjantaScene pump={false} align="xMaxYMid" />
        <View style={styles.brandBox}>
          <View style={styles.badge}>
            <AjantaLogo size={46} />
          </View>
          <Text style={[styles.title, tracking(i18n.language, 2)]} numberOfLines={1} adjustsFontSizeToFit>
            {brand.titleLine1}
          </Text>
          <Text style={[styles.subtitle, tracking(i18n.language, 3)]}>{brand.titleLine2}</Text>
        </View>
        <View style={styles.edge} />
      </View>

      <View style={styles.bottom}>
        <Text style={styles.tagline}>{t('splash.tagline')}</Text>
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loaderText}>{t('splash.starting')}</Text>
        </View>
        <Text style={styles.footer}>{t('splash.footer')}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: AJANTA_PAGE },
  banner: { flex: 1.15, backgroundColor: scene.banner, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  brandBox: { alignItems: 'center', paddingHorizontal: 24, paddingBottom: 24, width: '100%' },
  badge: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.55)',
    elevation: 4,
    shadowColor: colors.shadowTint,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  title: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '900',
    textAlign: 'center',
    textShadowColor: rgba(scene.titleShadow, 0.4),
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 1 },
  },
  subtitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 2,
    textShadowColor: rgba(scene.titleShadow, 0.4),
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 1 },
  },
  edge: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: 0,
    height: 20,
    backgroundColor: AJANTA_PAGE,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  bottom: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, paddingBottom: 28, paddingHorizontal: 24 },
  tagline: {
    color: colors.primaryDark,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  loader: { alignItems: 'center', gap: 10 },
  loaderText: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
  footer: { color: colors.textMuted, fontSize: 13, letterSpacing: 0.5, textAlign: 'center' },
});
