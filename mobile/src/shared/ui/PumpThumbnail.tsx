import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Rect, Circle, Path, Defs, LinearGradient, Stop, Ellipse } from 'react-native-svg';

interface PumpThumbnailProps {
  type?: '3PHASE' | 'SOLAR_VFD' | string;
  size?: number;
}

export const PumpThumbnail: React.FC<PumpThumbnailProps> = ({ type = '3PHASE', size = 56 }) => {
  const isSolar = type === 'SOLAR_VFD' || type?.toLowerCase().includes('solar');

  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius: Math.round(size * 0.22) }]}>
      <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
        <Defs>
          <LinearGradient id="thumbSky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#62B6FF" />
            <Stop offset="58%" stopColor="#C4E5FF" />
            <Stop offset="100%" stopColor="#E6F4FF" />
          </LinearGradient>
          <LinearGradient id="thumbGrass" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#65D03E" />
            <Stop offset="100%" stopColor="#288A1E" />
          </LinearGradient>
          <LinearGradient id="motorBody" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#2B7FFF" />
            <Stop offset="50%" stopColor="#1559C9" />
            <Stop offset="100%" stopColor="#0C3B8C" />
          </LinearGradient>
          <LinearGradient id="pipeMetal" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#94A3B8" />
            <Stop offset="50%" stopColor="#64748B" />
            <Stop offset="100%" stopColor="#334155" />
          </LinearGradient>
          <LinearGradient id="solarPanel" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#1E3A8A" />
            <Stop offset="100%" stopColor="#3B82F6" />
          </LinearGradient>
        </Defs>

        {/* Sky Background */}
        <Rect x="0" y="0" width="64" height="64" rx="14" fill="url(#thumbSky)" />

        {/* Soft Clouds */}
        <Ellipse cx="18" cy="15" rx="10" ry="3.5" fill="#FFFFFF" opacity={0.75} />
        <Ellipse cx="24" cy="13.5" rx="6" ry="3" fill="#FFFFFF" opacity={0.8} />
        <Ellipse cx="50" cy="12" rx="9" ry="2.8" fill="#FFFFFF" opacity={0.65} />

        {/* Rolling Green Field at bottom */}
        <Path d="M0 44 Q20 39 42 43 T64 42 L64 64 L0 64 Z" fill="#76DC4E" />
        <Path d="M0 47 Q26 44 64 46 L64 64 L0 64 Z" fill="url(#thumbGrass)" />

        {isSolar ? (
          <>
            {/* Solar Panel Mount & Panel */}
            <Path d="M24 50 L40 50 M32 50 L32 35" stroke="#475569" strokeWidth="3.2" strokeLinecap="round" />
            <Rect x="13" y="18" width="38" height="19" rx="2.5" fill="url(#solarPanel)" transform="rotate(-14 32 27)" />
            <Path d="M17 27 L47 27 M32 18 L32 36" stroke="#93C5FD" strokeWidth="1" opacity={0.65} />
            {/* Sun */}
            <Circle cx="13" cy="13" r="5.5" fill="#F59E0B" />
          </>
        ) : (
          <>
            {/* Water Pool on Left */}
            <Ellipse cx="13" cy="56" rx="11" ry="4" fill="#0284C7" opacity={0.85} />
            <Ellipse cx="13" cy="56" rx="7" ry="2.2" fill="#7DD3FC" opacity={0.9} />

            {/* Concrete Pad / Base */}
            <Path d="M22 47 L57 47 L60 53 L19 53 Z" fill="#94A3B8" />
            <Rect x="19" y="51" width="41" height="3.5" rx="1" fill="#64748B" />

            {/* Pump Volute / Impeller Housing (Centre-Left) */}
            <Rect x="25" y="29" width="11" height="18" rx="3" fill="#1D4ED8" />
            <Rect x="28" y="21" width="6" height="9" rx="1.5" fill="#1E40AF" />
            <Rect x="26.5" y="19.5" width="9" height="2.8" rx="1" fill="#3B82F6" />

            {/* Horizontal Electric Motor Body (Right) */}
            <Rect x="35" y="27" width="21" height="18" rx="4" fill="url(#motorBody)" />
            {/* Cooling Fins */}
            <Path d="M38 30 L53 30 M38 33.5 L53 33.5 M38 37 L53 37 M38 40.5 L53 40.5" stroke="#60A5FA" strokeWidth="1.2" opacity={0.75} strokeLinecap="round" />
            {/* Motor Terminal Box on top */}
            <Rect x="41" y="23.5" width="9" height="4" rx="1" fill="#1E3A8A" />
            {/* Motor Feet */}
            <Rect x="27" y="45" width="6" height="2.5" rx="0.8" fill="#0F172A" />
            <Rect x="46" y="45" width="7" height="2.5" rx="0.8" fill="#0F172A" />

            {/* Delivery Pipe & Elbow (Left) */}
            <Path d="M25 36 L14 36 Q11 36 11 39 L11 49" stroke="url(#pipeMetal)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
            <Rect x="22" y="33.5" width="3" height="5" rx="1" fill="#475569" />

            {/* Gushing Water Stream */}
            <Path d="M11 48 Q9 53 7 56 M11 48 Q11 53 12 56 M11 48 Q13 53 16 56" stroke="#E0F2FE" strokeWidth="2.2" strokeLinecap="round" />
            <Path d="M11 48 Q10 53 9 56" stroke="#38BDF8" strokeWidth="1.5" strokeLinecap="round" />
          </>
        )}
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    backgroundColor: '#C4E5FF',
    borderWidth: 1,
    borderColor: '#BFD9F2',
  },
});
