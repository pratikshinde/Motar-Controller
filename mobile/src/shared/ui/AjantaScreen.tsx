import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Bell, ChevronLeft, User } from 'lucide-react-native';
import { brand } from '@/config/brand';
import { useDirection } from '@/shared/i18n/useDirection';

/** The page colour under the banner; the banner ends in a rounded edge of this colour. */
export const AJANTA_PAGE = '#F8FAFC';

const Palms: React.FC = () => (
  <>
    <Path d="M338 160 Q331 128 340 96" stroke="#8A5A2B" strokeWidth={5} fill="none" strokeLinecap="round" />
    <Path d="M340 96 Q316 80 296 96" stroke="#2F8F3A" strokeWidth={5} fill="none" strokeLinecap="round" />
    <Path d="M340 96 Q320 70 300 70" stroke="#3FA34D" strokeWidth={5} fill="none" strokeLinecap="round" />
    <Path d="M340 96 Q346 66 366 60" stroke="#2F8F3A" strokeWidth={5} fill="none" strokeLinecap="round" />
    <Path d="M340 96 Q366 82 384 96" stroke="#3FA34D" strokeWidth={5} fill="none" strokeLinecap="round" />
    <Path d="M372 164 Q367 140 374 118" stroke="#8A5A2B" strokeWidth={4} fill="none" strokeLinecap="round" />
    <Path d="M374 118 Q356 106 342 118" stroke="#2F8F3A" strokeWidth={4} fill="none" strokeLinecap="round" />
    <Path d="M374 118 Q388 98 400 102" stroke="#3FA34D" strokeWidth={4} fill="none" strokeLinecap="round" />
  </>
);

const PumpArt: React.FC = () => (
  <>
    <Path d="M318 96 Q250 60 196 128" stroke="#EAF6FF" strokeWidth={14} opacity={0.85} fill="none" strokeLinecap="round" />
    <Path d="M318 96 Q256 70 206 128" stroke="#FFFFFF" strokeWidth={5} opacity={0.9} fill="none" strokeLinecap="round" />
    <Rect x="316" y="78" width="84" height="30" rx="6" fill="#244A8F" />
    <Rect x="308" y="72" width="14" height="42" rx="4" fill="#1B3A73" />
    <Rect x="356" y="100" width="44" height="60" rx="6" fill="#2B5AAE" />
  </>
);

/** A pipe pouring water onto the field (the Home header). */
const PipeWater: React.FC = () => (
  <>
    <Path d="M262 112 Q262 100 274 100 L300 100" stroke="#8C98A6" strokeWidth={9} fill="none" strokeLinecap="round" />
    <Path d="M262 112 L262 120" stroke="#6F7C8B" strokeWidth={11} strokeLinecap="round" />
    <Path d="M262 122 Q256 140 244 150 Q252 142 258 150" stroke="#EAF6FF" strokeWidth={10} opacity={0.9} fill="none" strokeLinecap="round" />
    <Ellipse cx="248" cy="154" rx="22" ry="5" fill="#FFFFFF" opacity={0.55} />
  </>
);

/** The sun and the clouds, on their own layer so they can drift. */
const Clouds: React.FC<{ align: string }> = ({ align }) => (
  <Svg style={StyleSheet.absoluteFill} viewBox="0 0 400 190" preserveAspectRatio={`${align} slice`}>
    <Circle cx="290" cy="58" r="36" fill="#FFFFFF" opacity={0.16} />
    <Ellipse cx="96" cy="74" rx="48" ry="10" fill="#FFFFFF" opacity={0.35} />
    <Ellipse cx="140" cy="64" rx="30" ry="8" fill="#FFFFFF" opacity={0.3} />
    <Ellipse cx="330" cy="40" rx="34" ry="7" fill="#FFFFFF" opacity={0.25} />
  </Svg>
);

/** Moves its children slowly side to side, unless the phone is set to reduce motion. */
const Drift: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [x] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (reduce || cancelled) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(x, { toValue: 14, duration: 9000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(x, { toValue: -14, duration: 9000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          ]),
        );
        loop.start();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [x]);
  return <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: x }] }]}>{children}</Animated.View>;
};

/**
 * A painted farm scene behind the header (there is no photo asset yet). `pump` draws a big pipe with water instead of the palms;
 * `pipe` adds a small pipe with water beside the palms. The clouds drift slowly.
 */
export const AjantaScene: React.FC<{ pump: boolean; pipe?: boolean; align?: 'xMidYMid' | 'xMaxYMid' }> = ({ pump, pipe, align = 'xMidYMid' }) => (
  <View style={StyleSheet.absoluteFill} pointerEvents="none">
    <Svg style={StyleSheet.absoluteFill} viewBox="0 0 400 190" preserveAspectRatio={`${align} slice`}>
      <Defs>
        <LinearGradient id="ajSky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#1A56D6" />
          <Stop offset="0.55" stopColor="#5DA7F4" />
          <Stop offset="1" stopColor="#CDE7FF" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="400" height="190" fill="url(#ajSky)" />
    </Svg>
    <Drift>
      <Clouds align={align} />
    </Drift>
    <Svg style={StyleSheet.absoluteFill} viewBox="0 0 400 190" preserveAspectRatio={`${align} slice`}>
      <Defs>
        <LinearGradient id="ajField" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#7CCB70" />
          <Stop offset="1" stopColor="#3E9A40" />
        </LinearGradient>
      </Defs>
      <Path d="M0 130 Q90 102 200 126 T400 114 L400 190 L0 190 Z" fill="#8FD17F" />
      <Path d="M0 152 Q120 128 240 150 T400 142 L400 190 L0 190 Z" fill="url(#ajField)" />
      {pump ? <PumpArt /> : <Palms />}
      {pipe ? <PipeWater /> : null}
    </Svg>
  </View>
);

/** The brand mark: a water drop with a green leaf (no logo file yet). */
export const AjantaLogo: React.FC<{ size?: number }> = ({ size = 40 }) => (
  <Svg width={size} height={size * 1.15} viewBox="0 0 40 46">
    <Path d="M20 2 C20 2 5 19 5 29 a15 15 0 0 0 30 0 C35 19 20 2 20 2 Z" fill="#FFFFFF" />
    <Path d="M20 8 C20 8 10 21 10 29 a10 10 0 0 0 20 0 C30 21 20 8 20 8 Z" fill="#1E6FE8" />
    <Path d="M11 33 Q20 21 31 31 Q22 41 11 33 Z" fill="#43A047" />
    <Path d="M14 33 Q21 29 28 31" stroke="#FFFFFF" strokeWidth={1.2} fill="none" strokeLinecap="round" />
  </Svg>
);

interface AjantaBannerProps {
  title: string;
  /** `pump` = a pipe with water behind the title (the Timer page); `farm` = fields and palms. */
  scene?: 'farm' | 'pump' | 'home';
  /** Given: a back arrow and the title only. Not given: the brand, the bell and the profile above the title. */
  onBack?: () => void;
  unreadAlerts?: number;
  onPressAlerts?: () => void;
  onPressProfile?: () => void;
}

/**
 * The header of Ajanta's Settings and Timer pages. It draws under the status bar itself. There is no Ajanta logo file
 * yet, so the brand is the text wordmark.
 */
export const AjantaBanner: React.FC<AjantaBannerProps> = ({
  title,
  scene = 'farm',
  onBack,
  unreadAlerts = 0,
  onPressAlerts,
  onPressProfile,
}) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { flip } = useDirection();
  const tagline = brand.appName.replace(new RegExp(`^${brand.shortName}\\s*`, 'i'), '').trim();

  return (
    <View style={[styles.banner, { paddingTop: insets.top }]}>
      <AjantaScene pump={scene === 'pump'} pipe={scene === 'home'} />
      {onBack ? (
        <View style={styles.backRow}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            activeOpacity={0.8}
          >
            <ChevronLeft size={30} color="#FFFFFF" style={flip} />
          </TouchableOpacity>
          <Text style={styles.backTitle} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.topRow}>
            <View style={styles.brandRow}>
              <AjantaLogo size={38} />
              <View style={styles.brandCol}>
                <Text style={styles.wordmark} numberOfLines={1}>
                  {brand.shortName}
                </Text>
                {tagline ? <Text style={styles.tagline}>{tagline}</Text> : null}
              </View>
            </View>
            <View style={styles.right}>
              <TouchableOpacity
                style={styles.bell}
                onPress={onPressAlerts}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={unreadAlerts > 0 ? `${t('nav.alerts')}, ${unreadAlerts}` : t('nav.alerts')}
              >
                <Bell size={28} color="#FFFFFF" />
                {unreadAlerts > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{unreadAlerts > 99 ? '99+' : unreadAlerts}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.avatar}
                onPress={onPressProfile}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={t('settings.profile')}
              >
                <User size={22} color="#3B9BEF" strokeWidth={2.4} />
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
        </>
      )}
      <View style={styles.edge} />
    </View>
  );
};

/** The frame of an Ajanta page: the banner, then a scrolling body on the page colour. */
export const AjantaScreen: React.FC<{ banner: AjantaBannerProps; children: React.ReactNode }> = ({ banner, children }) => (
  <View style={styles.root}>
    <AjantaBanner {...banner} />
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  </View>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: AJANTA_PAGE },
  scroll: { flex: 1, backgroundColor: AJANTA_PAGE },
  content: { padding: 12, gap: 12, paddingBottom: 32 },
  banner: { backgroundColor: '#1A56D6', overflow: 'hidden' },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  brandCol: { flexShrink: 1 },
  wordmark: { color: '#FFFFFF', fontSize: 26, fontWeight: '900', letterSpacing: 2 },
  tagline: { color: '#FFFFFF', fontSize: 13, fontWeight: '600', marginTop: -2, opacity: 0.95 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  bell: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 2,
    end: 2,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: '#E5352F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E2F2FD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '900',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 18,
    textShadowColor: 'rgba(0,0,40,0.35)',
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 1 },
  },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingTop: 14, paddingBottom: 34 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  backTitle: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,40,0.35)',
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 1 },
  },
  edge: { height: 14, backgroundColor: AJANTA_PAGE, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
});
