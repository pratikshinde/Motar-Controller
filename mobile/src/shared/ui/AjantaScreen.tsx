import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, Platform, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Bell, ChevronLeft, RefreshCw, User } from 'lucide-react-native';
import { brand } from '@/config/brand';
import { useDirection } from '@/shared/i18n/useDirection';
import { colors } from '@/shared/theme';
import { rgba } from '@/shared/theme/color';
import { scene as paint } from '@/shared/theme/scene';

/** The page colour under the banner; the banner ends in a rounded edge of this colour. */
export const AJANTA_PAGE = colors.bg;

const Palms: React.FC = () => (
  <>
    <Path d="M338 160 Q331 128 340 96" stroke={paint.trunk} strokeWidth={5} fill="none" strokeLinecap="round" />
    <Path d="M340 96 Q316 80 296 96" stroke={paint.frondDark} strokeWidth={5} fill="none" strokeLinecap="round" />
    <Path d="M340 96 Q320 70 300 70" stroke={paint.frondLight} strokeWidth={5} fill="none" strokeLinecap="round" />
    <Path d="M340 96 Q346 66 366 60" stroke={paint.frondDark} strokeWidth={5} fill="none" strokeLinecap="round" />
    <Path d="M340 96 Q366 82 384 96" stroke={paint.frondLight} strokeWidth={5} fill="none" strokeLinecap="round" />
    <Path d="M372 164 Q367 140 374 118" stroke={paint.trunk} strokeWidth={4} fill="none" strokeLinecap="round" />
    <Path d="M374 118 Q356 106 342 118" stroke={paint.frondDark} strokeWidth={4} fill="none" strokeLinecap="round" />
    <Path d="M374 118 Q388 98 400 102" stroke={paint.frondLight} strokeWidth={4} fill="none" strokeLinecap="round" />
  </>
);

const PumpArt: React.FC = () => (
  <>
    <Path d="M318 96 Q250 60 196 128" stroke={paint.water} strokeWidth={14} opacity={0.85} fill="none" strokeLinecap="round" />
    <Path d="M318 96 Q256 70 206 128" stroke="#FFFFFF" strokeWidth={5} opacity={0.9} fill="none" strokeLinecap="round" />
    <Rect x="316" y="78" width="84" height="30" rx="6" fill={paint.pumpBody} />
    <Rect x="308" y="72" width="14" height="42" rx="4" fill={paint.pumpDark} />
    <Rect x="356" y="100" width="44" height="60" rx="6" fill={paint.pumpLight} />
  </>
);

/** A pipe pouring water onto the field (the Home header). */
const PipeWater: React.FC = () => (
  <>
    <Path d="M262 112 Q262 100 274 100 L300 100" stroke={paint.pipe} strokeWidth={9} fill="none" strokeLinecap="round" />
    <Path d="M262 112 L262 120" stroke={paint.pipeDark} strokeWidth={11} strokeLinecap="round" />
    <Path d="M262 122 Q256 140 244 150 Q252 142 258 150" stroke={paint.water} strokeWidth={10} opacity={0.9} fill="none" strokeLinecap="round" />
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
export const AjantaScene: React.FC<{ pump: boolean; pipe?: boolean; align?: 'xMidYMid' | 'xMaxYMid'; sky?: boolean; trees?: boolean }> = ({
  pump,
  pipe,
  align = 'xMidYMid',
  sky = true,
  trees = false,
}) => (
  <View style={StyleSheet.absoluteFill} pointerEvents="none">
    {sky ? (
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 400 190" preserveAspectRatio={`${align} slice`}>
        <Defs>
          <LinearGradient id="ajSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={paint.skyTop} />
            <Stop offset="0.55" stopColor={paint.skyMid} />
            <Stop offset="1" stopColor={paint.skyLow} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="400" height="190" fill="url(#ajSky)" />
      </Svg>
    ) : null}
    <Drift>
      <Clouds align={align} />
    </Drift>
    <Svg style={StyleSheet.absoluteFill} viewBox="0 0 400 190" preserveAspectRatio={`${align} slice`}>
      <Defs>
        <LinearGradient id="ajField" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={paint.fieldTop} />
          <Stop offset="1" stopColor={paint.fieldBottom} />
        </LinearGradient>
      </Defs>
      <Path d="M0 130 Q90 102 200 126 T400 114 L400 190 L0 190 Z" fill={paint.hillFar} />
      <Path d="M0 152 Q120 128 240 150 T400 142 L400 190 L0 190 Z" fill="url(#ajField)" />
      {trees ? <Trees /> : null}
      {pump ? <PumpArt /> : trees ? null : <Palms />}
      {pipe ? <PipeWater /> : null}
    </Svg>
  </View>
);

/** Round trees and crop rows on the left of the field (the splash screen). */
const Trees: React.FC = () => (
  <>
    <Path d="M30 132 L30 108" stroke={paint.trunk} strokeWidth={3} strokeLinecap="round" />
    <Circle cx="30" cy="100" r="14" fill={paint.frondDark} opacity={0.85} />
    <Circle cx="40" cy="106" r="10" fill={paint.frondLight} opacity={0.85} />
    <Path d="M66 134 L66 116" stroke={paint.trunk} strokeWidth={3} strokeLinecap="round" />
    <Circle cx="66" cy="110" r="11" fill={paint.frondDark} opacity={0.8} />
    <Path d="M0 160 Q70 140 150 158" stroke="#FFFFFF" strokeWidth={1.4} opacity={0.25} fill="none" />
    <Path d="M0 172 Q80 150 170 170" stroke="#FFFFFF" strokeWidth={1.4} opacity={0.22} fill="none" />
    <Path d="M0 184 Q90 160 190 182" stroke="#FFFFFF" strokeWidth={1.4} opacity={0.2} fill="none" />
  </>
);

/** The purple gradient with soft waves behind the sign-in header (no farm: the card below is the focus). */
export const AjantaHeaderBackdrop: React.FC = () => (
  <View style={StyleSheet.absoluteFill} pointerEvents="none">
    <Svg style={StyleSheet.absoluteFill} viewBox="0 0 400 260" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="ajHead" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={colors.primary} />
          <Stop offset="1" stopColor={colors.primaryDark} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="400" height="260" fill="url(#ajHead)" />
      <Circle cx="60" cy="30" r="120" fill="#FFFFFF" opacity={0.07} />
      <Circle cx="380" cy="60" r="70" fill="#FFFFFF" opacity={0.05} />
      <Path d="M0 170 Q110 120 230 165 T400 140 L400 260 L0 260 Z" fill="#FFFFFF" opacity={0.07} />
      <Path d="M0 205 Q130 160 260 198 T400 178 L400 260 L0 260 Z" fill="#FFFFFF" opacity={0.08} />
    </Svg>
  </View>
);

/** A faint wave at the bottom of the page, so the white card does not float on a flat colour. */
export const AjantaPageWave: React.FC = () => (
  <View style={styles.pageWave} pointerEvents="none">
    <Svg width="100%" height="100%" viewBox="0 0 400 160" preserveAspectRatio="none">
      <Path d="M0 70 Q100 20 220 62 T400 40 L400 160 L0 160 Z" fill={colors.primary} opacity={0.07} />
      <Path d="M0 110 Q120 70 250 104 T400 88 L400 160 L0 160 Z" fill={colors.primary} opacity={0.09} />
    </Svg>
  </View>
);

/** The brand mark: Ajanta's coloured triangles, on a white round badge so they read on the blue banner. */
export const AjantaLogo: React.FC<{ size?: number }> = ({ size = 40 }) => {
  const badge = Math.round(size * 1.25);
  const w = size * 0.8;
  return (
    <View style={{ width: badge, height: badge, borderRadius: badge / 2, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
      <Image source={require('../../../brands/ajanta/mark.png')} style={{ width: w, height: w / 1.13 }} resizeMode="contain" accessibilityIgnoresInvertColors />
    </View>
  );
};

/** The whole Ajanta logo (triangles and the word), for the splash screen. */
export const AjantaFullLogo: React.FC<{ width?: number }> = ({ width = 240 }) => (
  <Image source={require('../../../brands/ajanta/logo.png')} style={{ width, height: width / 3.91 }} resizeMode="contain" accessibilityLabel={brand.shortName} />
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
                <User size={22} color={paint.avatarIcon} strokeWidth={2.4} />
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

interface AjantaSubHeaderProps {
  title: string;
  onBack?: () => void;
  backLabel?: string;
  /** Something small on the right (a button). */
  right?: React.ReactNode;
  onRefresh?: () => void;
  refreshLabel?: string;
}

/**
 * The header of Ajanta's secondary pages (History, Technical, Schedule, My Pumps, Problems, Manage): the same painted sky and farm as
 * the Home, Timer and More pages, a back arrow, the title, and the rounded edge onto the page colour. It makes room for the status bar.
 */
export const AjantaSubHeader: React.FC<AjantaSubHeaderProps> = ({ title, onBack, backLabel, right, onRefresh, refreshLabel }) => {
  const { flip } = useDirection();
  const top = Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0;
  return (
    <View style={[styles.subBanner, { paddingTop: top }]}>
      <AjantaScene pump={false} />
      <View style={styles.subRow}>
        <View style={styles.subSide}>
          {onBack ? (
            <TouchableOpacity style={styles.backBtn} onPress={onBack} accessibilityRole="button" accessibilityLabel={backLabel} activeOpacity={0.8}>
              <ChevronLeft size={30} color="#FFFFFF" style={flip} />
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={styles.subTitle} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        <View style={[styles.subSide, { alignItems: 'flex-end' }]}>
          {right ??
            (onRefresh ? (
              <TouchableOpacity style={styles.backBtn} onPress={onRefresh} accessibilityRole="button" accessibilityLabel={refreshLabel} activeOpacity={0.8}>
                <RefreshCw size={22} color="#FFFFFF" />
              </TouchableOpacity>
            ) : null)}
        </View>
      </View>
      <View style={styles.subEdge} />
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
  pageWave: { position: 'absolute', start: 0, end: 0, bottom: 0, height: 170 },
  scroll: { flex: 1, backgroundColor: AJANTA_PAGE },
  content: { padding: 12, gap: 12, paddingBottom: 32 },
  banner: { backgroundColor: paint.banner, overflow: 'hidden' },
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
    backgroundColor: paint.badge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: paint.avatarBg,
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
    textShadowColor: rgba(paint.titleShadow, 0.4),
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
    textShadowColor: rgba(paint.titleShadow, 0.4),
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 1 },
  },
  edge: { height: 14, backgroundColor: AJANTA_PAGE, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  subBanner: { backgroundColor: paint.banner, overflow: 'hidden' },
  subRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingTop: 10, paddingBottom: 24, minHeight: 78 },
  subSide: { minWidth: 48 },
  subTitle: {
    flex: 1,
    textAlign: 'center',
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
    textShadowColor: rgba(paint.titleShadow, 0.4),
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 1 },
  },
  subEdge: { position: 'absolute', start: 0, end: 0, bottom: 0, height: 14, backgroundColor: AJANTA_PAGE, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
});
