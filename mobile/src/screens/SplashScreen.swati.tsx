import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Rect, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { SwatiLogo } from '../shared/ui/SwatiLogo';

interface SplashScreenProps {
  onFinish: () => void;
}

export const SplashScreenSwati: React.FC<SplashScreenProps> = ({ onFinish }) => {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      {/* Sky & Farm Background Illustration */}
      <View style={StyleSheet.absoluteFill}>
        <Svg width="100%" height="100%" viewBox="0 0 360 800" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#BAE6FD" />
              <Stop offset="45%" stopColor="#E0F2FE" />
              <Stop offset="70%" stopColor="#FFFFFF" />
            </LinearGradient>
            <LinearGradient id="hillGrad1" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#86EFAC" />
              <Stop offset="100%" stopColor="#22C55E" />
            </LinearGradient>
            <LinearGradient id="hillGrad2" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#4ADE80" />
              <Stop offset="100%" stopColor="#15803D" />
            </LinearGradient>
            <LinearGradient id="waterStream" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor="#60A5FA" />
              <Stop offset="50%" stopColor="#38BDF8" />
              <Stop offset="100%" stopColor="#0284C7" />
            </LinearGradient>
            <LinearGradient id="pipeMetal" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#475569" />
              <Stop offset="50%" stopColor="#1E293B" />
              <Stop offset="100%" stopColor="#0F172A" />
            </LinearGradient>
          </Defs>

          {/* Sky background */}
          <Rect x="0" y="0" width="360" height="800" fill="url(#skyGrad)" />

          {/* Distant Trees & Green Hills */}
          <Path d="M0 430 Q90 380 180 410 T360 390 L360 800 L0 800 Z" fill="url(#hillGrad1)" opacity={0.6} />
          <Path d="M0 470 Q120 430 240 460 T360 440 L360 800 L0 800 Z" fill="url(#hillGrad2)" opacity={0.8} />

          {/* Foreground Crop Field */}
          <Path d="M0 530 Q100 510 200 530 T360 520 L360 800 L0 800 Z" fill="#166534" />

          {/* Pump Water Pipe on the right/center flowing into field */}
          {/* Metal Pipe */}
          <Path
            d="M360 560 L240 560 C210 560 190 580 190 610 L190 680"
            stroke="url(#pipeMetal)"
            strokeWidth="28"
            strokeLinecap="round"
            fill="none"
          />
          {/* Pipe Flange & Valve */}
          <Rect x="230" y="542" width="12" height="36" rx="4" fill="#64748B" />
          <Circle cx="210" cy="540" r="10" fill="#EF4444" />

          {/* Water Gush Stream */}
          <Path
            d="M190 640 C170 660 120 700 30 760 L0 800 L160 800 C200 750 210 700 200 640 Z"
            fill="url(#waterStream)"
            opacity={0.85}
          />
          <Path
            d="M190 640 C180 670 140 720 70 780"
            stroke="#BAE6FD"
            strokeWidth="8"
            strokeLinecap="round"
            fill="none"
          />

          {/* Plants in foreground */}
          <Circle cx="40" cy="560" r="14" fill="#22C55E" />
          <Circle cx="70" cy="570" r="18" fill="#16A34A" />
          <Circle cx="120" cy="590" r="16" fill="#15803D" />
          <Circle cx="300" cy="620" r="22" fill="#166534" />
        </Svg>
      </View>

      <SafeAreaView style={styles.safe}>
        {/* Top Swati Branding */}
        <View style={styles.topSection}>
          <SwatiLogo size={74} />
          <Text style={styles.brandTitle}>SWATI</Text>
          <Text style={styles.tagline}>{t('splash.tagline')}</Text>
        </View>

        {/* Bottom CTA Button */}
        <View style={styles.bottomSection}>
          <TouchableOpacity
            style={styles.startButton}
            onPress={onFinish}
            activeOpacity={0.85}
            accessibilityRole="button"
            testID="splash-start-button"
          >
            <Text style={styles.startButtonText}>{`${t('swati.start')} →`}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#E0F2FE',
  },
  safe: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  topSection: {
    alignItems: 'center',
    marginTop: 40,
  },
  brandTitle: {
    fontSize: 32,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: 3,
    marginTop: 12,
  },
  tagline: {
    fontSize: 16,
    color: '#334155',
    fontWeight: '700',
    marginTop: 6,
    textAlign: 'center',
  },
  bottomSection: {
    marginBottom: 24,
    width: '100%',
    alignItems: 'center',
  },
  startButton: {
    backgroundColor: '#1565C0',
    borderRadius: 28,
    paddingVertical: 16,
    paddingHorizontal: 36,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#1565C0',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  startButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
