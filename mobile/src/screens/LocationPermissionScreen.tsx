import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { MapPin, ShieldCheck, Zap, Radio } from 'lucide-react-native';
import { colors, font, radius, space, TOUCH } from '../shared/theme';

interface LocationPermissionScreenProps {
  onPermissionGranted: () => void;
  onSkip: () => void;
}

export const LocationPermissionScreen: React.FC<LocationPermissionScreenProps> = ({
  onPermissionGranted,
  onSkip,
}) => {
  const [loading, setLoading] = useState(false);

  const handleGrant = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      onPermissionGranted();
    }, 700);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.stepBadge}>
          <Text style={styles.stepBadgeText}>STEP 2 OF 3 • PUMP LOCATION</Text>
        </View>

        <View style={styles.iconRing}>
          <View style={styles.iconCore}>
            <MapPin size={46} color={colors.primary} />
          </View>
        </View>

        <Text style={styles.title}>Enable Pump Geo-Location</Text>
        <Text style={styles.subtitle}>
          Ajanta Pump Controller requires location permission to map and track your pump installation site, detect local substation grid availability, and safeguard equipment.
        </Text>

        <View style={styles.benefitList}>
          <View style={styles.benefitItem}>
            <Radio size={22} color={colors.accent} />
            <Text style={styles.benefitText}>
              Accurately pin Borewell and Canal pump field coordinates
            </Text>
          </View>
          <View style={styles.benefitItem}>
            <Zap size={22} color={colors.accent} />
            <Text style={styles.benefitText}>
              Receive regional electrical grid load & outage updates
            </Text>
          </View>
          <View style={styles.benefitItem}>
            <ShieldCheck size={22} color={colors.accent} />
            <Text style={styles.benefitText}>
              Smart anti-theft geofencing for motor and starter
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.grantBtn}
            onPress={handleGrant}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.grantBtnText}>Allow Location Access</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.skipBtn} onPress={onSkip} activeOpacity={0.7}>
            <Text style={styles.skipBtnText}>Skip for Now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(46, 125, 50, 0.12)',
    marginBottom: 24,
  },
  stepBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: 1,
  },
  iconRing: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: 'rgba(46, 125, 50, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  iconCore: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
  },
  benefitList: { width: '100%', gap: 14, marginBottom: 32 },
  benefitItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  benefitText: { flex: 1, fontSize: 13, color: colors.text, fontWeight: '500' },
  actions: { width: '100%', gap: 12 },
  grantBtn: {
    height: TOUCH.minHeight,
    borderRadius: radius.card,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grantBtnText: {
    fontSize: font.body,
    fontWeight: '700',
    color: colors.textOnPrimary,
    letterSpacing: 0.5,
  },
  skipBtn: {
    height: TOUCH.minHeight - 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipBtnText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
});
