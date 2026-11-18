import React from 'react';
import { View, StyleSheet, Text, Image } from 'react-native';
import { brand } from '@/config/brand';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logoImage = require('../../../brands/swati/logo.png');

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
      {/* SolarLogger's own picture: brands/swati/logo.png (a rounded blue square), not a drawing */}
      <Image
        source={logoImage}
        style={{ width: size, height: size, borderRadius: size * 0.22 }}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />

      {showText && (
        <View style={styles.textWrap}>
          <Text style={[styles.brandText, { color: textColor }]}>{brand.shortName}</Text>
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
