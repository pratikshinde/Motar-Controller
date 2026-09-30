import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, Platform, StatusBar } from 'react-native';
import { ChevronLeft, RefreshCw } from 'lucide-react-native';
import { colors, font, TOUCH } from '../theme';
import { useDirection } from '../i18n/useDirection';

/** Green top bar for the secondary screens (pump list, alerts). */
export const ScreenHeader: React.FC<{
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backLabel?: string;
  refreshLabel?: string;
  onRefresh?: () => void;
}> = ({ title, subtitle, onBack, backLabel, refreshLabel, onRefresh }) => {
  const { flip } = useDirection();
  return (
    <View style={styles.bar}>
      <View style={styles.side}>
        {onBack && (
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={backLabel}
            activeOpacity={0.7}
          >
            <ChevronLeft size={26} color={colors.textOnPrimary} style={flip} />
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.center}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={[styles.side, { alignItems: 'flex-end' }]}>
        {onRefresh && (
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={onRefresh}
            accessibilityRole="button"
            accessibilityLabel={refreshLabel}
            activeOpacity={0.7}
          >
            <RefreshCw size={22} color={colors.textOnPrimary} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 8,
    paddingBottom: 10,
  },
  side: { width: TOUCH - 4 },
  center: { flex: 1, alignItems: 'center' },
  title: { color: colors.textOnPrimary, fontSize: font.title, fontWeight: '800' },
  subtitle: { color: '#CFEBD6', fontSize: 13, marginTop: 1 },
  iconBtn: {
    width: TOUCH - 8,
    height: TOUCH - 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
