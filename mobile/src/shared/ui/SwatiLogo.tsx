import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';

interface SwatiLogoProps {
  size?: number;
  showText?: boolean;
  textColor?: string;
  tagline?: string;
}

export const SwatiLogo: React.FC<SwatiLogoProps> = ({
  size = 64,
  showText = false,
  textColor = '#0F172A',
  tagline,
}) => {
  return (
    <View style={styles.container}>
      <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
        <Defs>
          <LinearGradient id="waterGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#29B6F6" />
            <Stop offset="100%" stopColor="#1565C0" />
          </LinearGradient>
          <LinearGradient id="leafGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#4ADE80" />
            <Stop offset="100%" stopColor="#16A34A" />
          </LinearGradient>
        </Defs>

        {/* Outer green curving leaf */}
        <Path
          d="M28 78 C20 62 24 38 42 22 C36 34 35 48 41 62 C46 72 56 79 68 81 C55 86 38 86 28 78 Z"
          fill="url(#leafGrad)"
        />

        {/* Central blue water droplet */}
        <Path
          d="M56 18 C56 18 36 46 36 62 C36 76 47 84 58 84 C69 84 80 76 80 62 C80 46 56 18 56 18 Z"
          fill="url(#waterGrad)"
        />

        {/* Inner water droplet highlight */}
        <Path
          d="M62 38 C62 38 50 54 50 64 C50 71 55 76 60 76 C56 75 52 70 52 64 C52 54 62 38 62 38 Z"
          fill="#FFFFFF"
          opacity={0.35}
        />
      </Svg>

      {showText && (
        <View style={styles.textWrap}>
          <Text style={[styles.brandText, { color: textColor }]}>SWATI</Text>
          {tagline ? <Text style={styles.tagline}>{tagline}</Text> : null}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    alignItems: 'center',
    marginTop: 6,
  },
  brandText: {
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 2.5,
  },
  tagline: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '600',
    marginTop: 2,
    textAlign: 'center',
  },
});
