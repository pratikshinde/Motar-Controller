import React from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Bell, Sparkles, User } from 'lucide-react-native';
import { SwatiLogo } from './SwatiLogo';
import { brand } from '@/config/brand';

interface SwatiTopBarProps {
  farmerName?: string;
  unreadAlerts?: number;
  onPressAlerts?: () => void;
  onPressProfile?: () => void;
}

export const SwatiTopBar: React.FC<SwatiTopBarProps> = ({
  farmerName = '',
  unreadAlerts = 0,
  onPressAlerts,
  onPressProfile,
}) => {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      {/* 1. Deep Blue Gradient Header */}
      <View style={styles.topBar}>
        <View style={styles.brandRow}>
          <View style={styles.logoBadge}>
            <SwatiLogo size={30} />
          </View>
          <View>
            <View style={styles.brandTitleRow}>
              <Text style={styles.brandTitle}>{brand.shortName}</Text>
            </View>
            <Text style={styles.brandTagline}>SMART PUMP CONTROLLER</Text>
          </View>
        </View>

        <View style={styles.rightIcons}>
          {/* Notifications Bell with Glowing Badge */}
          <TouchableOpacity
            style={styles.iconButton}
            onPress={onPressAlerts}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t('nav.alerts')}
          >
            <Bell size={21} color="#FFFFFF" />
            {unreadAlerts > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadAlerts > 99 ? '99+' : unreadAlerts}</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Farmer Profile Avatar */}
          <TouchableOpacity
            style={styles.avatarWrap}
            onPress={onPressProfile}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t('settings.profile')}
          >
            <View style={styles.avatarCircle}>
              <User size={18} color="#FFFFFF" />
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* 2. Personalized Farmer Greeting Bar */}
      <View style={styles.greetingBar}>
        <View style={styles.greetingLeft}>
          <Sparkles size={16} color="#0284C7" />
          <Text style={styles.greetingText}>
            {farmerName ? t('swati.hello', { name: farmerName }) : t('swati.helloNoName')}
          </Text>
        </View>
        <View style={styles.liveSyncBadge}>
          <View style={styles.liveSyncDot} />
          <Text style={styles.liveSyncText}>Live Telemetry</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0D47A1',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoBadge: {
    padding: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  brandTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  brandTitle: {
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: '900',
    letterSpacing: 1.8,
  },
  brandTagline: {
    color: '#93C5FD',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginTop: 1,
  },
  rightIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#DC2626',
    borderRadius: 10,
    minWidth: 19,
    height: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#0D47A1',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
  },
  avatarWrap: {
    padding: 1,
  },
  avatarCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderWidth: 2,
    borderColor: '#93C5FD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  greetingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  greetingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  greetingText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  liveSyncBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  liveSyncDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  liveSyncText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
  },
});
