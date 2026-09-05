import React, { useEffect } from 'react';
import { StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { Activity, Zap, ShieldCheck } from 'lucide-react-native';

interface SplashScreenProps {
  onFinish: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onFinish }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onFinish();
    }, 2200);
    return () => clearTimeout(timer);
  }, [onFinish]);

  return (
    <View style={styles.container}>
      {/* Top Scan Line */}
      <View style={styles.scanLine} />

      <View style={styles.centerBox}>
        {/* Animated Glowing Logo Icon */}
        <View style={styles.logoOuterGlow}>
          <View style={styles.logoInnerBox}>
            <Activity size={44} color="#00e5ff" />
          </View>
        </View>

        {/* Title */}
        <Text style={styles.titleLine1}>AJANTA PUMP</Text>
        <Text style={styles.titleLine2}>CONTROLLER</Text>

        {/* Subtitle pill */}
        <View style={styles.tagBadge}>
          <Zap size={12} color="#00e676" />
          <Text style={styles.tagText}>3-PHASE 440V SMART IOT SYSTEM</Text>
        </View>

        {/* Loading Spinner & Status */}
        <View style={styles.loaderBox}>
          <ActivityIndicator size="large" color="#00e676" />
          <Text style={styles.loaderText}>Connecting telemetry stream...</Text>
        </View>
      </View>

      {/* Footer Branding */}
      <View style={styles.footerBox}>
        <View style={styles.footerSecureRow}>
          <ShieldCheck size={14} color="#00e5ff" />
          <Text style={styles.footerSecureText}>SECURE HARDWARE ENCLAVE ACTIVE</Text>
        </View>
        <Text style={styles.versionText}>AGRI-PUMP OS • v2.4.0-DEMO</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060b14',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  scanLine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: '#00e5ff',
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  logoOuterGlow: {
    width: 96,
    height: 96,
    borderRadius: 24,
    backgroundColor: '#00e5ff12',
    borderWidth: 1.5,
    borderColor: '#00e5ff40',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  logoInnerBox: {
    width: 76,
    height: 76,
    borderRadius: 18,
    backgroundColor: '#0c1220',
    borderWidth: 1,
    borderColor: '#00e5ff80',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleLine1: {
    color: '#e8edf5',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 2.5,
    textAlign: 'center',
    lineHeight: 32,
  },
  titleLine2: {
    color: '#00e5ff',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 2,
    textAlign: 'center',
    lineHeight: 28,
    marginTop: 2,
  },
  tagBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#111a2e',
    borderColor: '#1c2a45',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 14,
  },
  tagText: {
    color: '#7a8baa',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  loaderBox: {
    alignItems: 'center',
    marginTop: 44,
    gap: 12,
  },
  loaderText: {
    color: '#4a5a78',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
  },
  footerBox: {
    alignItems: 'center',
    gap: 6,
  },
  footerSecureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footerSecureText: {
    color: '#00e5ff',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1,
  },
  versionText: {
    color: '#4a5a78',
    fontSize: 10,
    letterSpacing: 1,
  },
});
