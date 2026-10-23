import { SplashScreenSwati } from './SplashScreen.swati';
import React, { useEffect } from 'react';
import { StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { Droplets, Sprout } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { colors, font, radius } from '../shared/theme';
import { brand } from '../config/brand';
import { tracking } from '../shared/i18n/languages';

interface SplashScreenProps {
  onFinish: () => void;
}

const SplashScreenClassic: React.FC<SplashScreenProps> = ({ onFinish }) => {
  const { t, i18n } = useTranslation();
  useEffect(() => {
    const timer = setTimeout(() => {
      onFinish();
    }, 2200);
    return () => clearTimeout(timer);
  }, [onFinish]);

  return (
    <View style={styles.container}>
      <View style={styles.centerBox}>
        <View style={styles.logoRing}>
          <View style={styles.logoCore}>
            <Droplets size={52} color={colors.water} />
          </View>
          <View style={styles.sprout}>
            <Sprout size={22} color={colors.primaryDark} />
          </View>
        </View>

        <Text style={[styles.titleLine1, tracking(i18n.language, 2)]}>{brand.titleLine1}</Text>
        <Text style={[styles.titleLine2, tracking(i18n.language, 3)]}>{brand.titleLine2}</Text>
        <Text style={styles.tagline}>{t('splash.tagline')}</Text>

        <View style={styles.loaderBox}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.loaderText}>{t('splash.starting')}</Text>
        </View>
      </View>

      <Text style={styles.footer}>{t('splash.footer')}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', width: '100%' },
  logoRing: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  logoCore: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sprout: {
    position: 'absolute',
    right: 6,
    bottom: 8,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.primary,
  },
  titleLine1: {
    color: colors.textOnPrimary,
    fontSize: font.display,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
  },
  titleLine2: {
    color: '#CFEBD6',
    fontSize: font.headline,
    fontWeight: '800',
    letterSpacing: 3,
    textAlign: 'center',
    marginTop: 2,
  },
  tagline: {
    color: colors.textOnPrimary,
    fontSize: font.body,
    marginTop: 14,
    opacity: 0.92,
    backgroundColor: 'rgba(0,0,0,0.14)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  loaderBox: { alignItems: 'center', marginTop: 48, gap: 10 },
  loaderText: { color: '#E3F3E6', fontSize: font.body, fontWeight: '600' },
  footer: { color: '#CFEBD6', fontSize: 13, letterSpacing: 0.5 },
});


export const SplashScreen: typeof SplashScreenClassic = brand.design === 'swati' ? SplashScreenSwati : SplashScreenClassic;
