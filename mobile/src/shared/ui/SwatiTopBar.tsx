import React from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Bell, User } from 'lucide-react-native';
import { SwatiLogo } from './SwatiLogo';

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
      {/* Blue Top Nav Bar */}
      <View style={styles.topBar}>
        <View style={styles.brandRow}>
          <SwatiLogo size={28} />
          <Text style={styles.brandTitle}>SWATI</Text>
        </View>

        <View style={styles.rightIcons}>
          {/* Notifications Bell */}
          <TouchableOpacity
            style={styles.iconButton}
            onPress={onPressAlerts}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t('nav.alerts')}
          >
            <Bell size={22} color="#FFFFFF" />
            {unreadAlerts > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadAlerts}</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Farmer Avatar */}
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

      {/* Greeting Banner below header */}
      <View style={styles.greetingBar}>
        <Text style={styles.greetingText}>{farmerName ? t('swati.hello', { name: farmerName }) : t('swati.helloNoName')}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1565C0',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 2,
  },
  rightIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: '#DC2626',
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
  },
  avatarWrap: {
    padding: 2,
  },
  avatarCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  greetingBar: {
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  greetingText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
});
