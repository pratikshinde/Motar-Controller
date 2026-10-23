import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Rect, Circle, Path, Defs, LinearGradient, Stop } from 'react-native-svg';

interface PumpThumbnailProps {
  type?: '3PHASE' | 'SOLAR_VFD' | string;
  size?: number;
}

export const PumpThumbnail: React.FC<PumpThumbnailProps> = ({ type = '3PHASE', size = 48 }) => {
  const isSolar = type === 'SOLAR_VFD' || type?.toLowerCase().includes('solar');

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox="0 0 60 60" fill="none">
        <Defs>
          <LinearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#BAE6FD" />
            <Stop offset="60%" stopColor="#E0F2FE" />
            <Stop offset="100%" stopColor="#86EFAC" />
          </LinearGradient>
          <LinearGradient id="solarPanel" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#1E3A8A" />
            <Stop offset="100%" stopColor="#3B82F6" />
          </LinearGradient>
        </Defs>

        {/* Thumbnail Background Sky & Grass */}
        <Rect x="0" y="0" width="60" height="60" rx="8" fill="url(#bgGrad)" />

        {isSolar ? (
          <>
            {/* Solar Panel Mount & Panel */}
            <Path d="M22 45 L38 45 M30 45 L30 32" stroke="#475569" strokeWidth="3" strokeLinecap="round" />
            <Rect x="12" y="16" width="36" height="18" rx="2" fill="url(#solarPanel)" transform="rotate(-15 30 25)" />
            <Path d="M16 25 L44 25 M30 16 L30 34" stroke="#93C5FD" strokeWidth="1" opacity={0.6} />
            {/* Small Sun in sky */}
            <Circle cx="12" cy="12" r="5" fill="#F59E0B" />
          </>
        ) : (
          <>
            {/* Borewell Pump Stand & Water Pipe */}
            {/* Ground line */}
            <Path d="M4 52 L56 52" stroke="#15803D" strokeWidth="4" strokeLinecap="round" />
            {/* Vertical Pump Column pipe */}
            <Rect x="24" y="22" width="10" height="30" fill="#334155" rx="1" />
            {/* Horizontal Delivery pipe */}
            <Path d="M24 26 L12 26 L12 34" stroke="#334155" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            {/* Gushing water drop */}
            <Path d="M12 36 Q10 44 14 46 T12 36" fill="#0284C7" />
            {/* Motor on top */}
            <Rect x="22" y="10" width="14" height="13" rx="3" fill="#1565C0" />
            <Rect x="20" y="8" width="18" height="3" fill="#64748B" rx="1" />
          </>
        )}
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#E0F2FE',
  },
});
