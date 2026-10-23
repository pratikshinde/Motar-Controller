import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Bell, Droplets, Settings } from 'lucide-react-native';
import { useListAlerts } from '@/api/generated/farmer';
import { colors } from '../theme';

const ITEMS: Record<string, { labelKey: string; Icon: React.ComponentType<{ size?: number; color?: string }> }> = {
  index: { labelKey: 'nav.pumps', Icon: Droplets },
  alerts: { labelKey: 'nav.alerts', Icon: Bell },
  settings: { labelKey: 'nav.settings', Icon: Settings },
};

export interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: { emit: (event: { type: string; target: string; canPreventDefault?: boolean }) => { defaultPrevented: boolean }; navigate: (name: string) => void };
}

/** Big, labelled tabs: icon + word, never icon alone. The Alerts tab shows how many are open. */
export const TabBar: React.FC<TabBarProps> = ({ state, navigation }) => {
  const { t } = useTranslation();
  const alerts = useListAlerts({ unresolved_only: true });
  const open = (alerts.data?.alerts ?? []).length;

  return (
    <SafeAreaView edges={['bottom']} style={styles.safe}>
      <View style={styles.bar} accessibilityRole="tablist">
        {state.routes.map((route: any, index: number) => {
          const item = ITEMS[route.name];
          if (!item) return null;
          const on = state.index === index;
          const label = t(item.labelKey);
          const Icon = item.Icon;
          return (
            <TouchableOpacity
              key={route.key}
              style={styles.item}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!on && !event.defaultPrevented) navigation.navigate(route.name);
              }}
              activeOpacity={0.7}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={route.name === 'alerts' && open > 0 ? `${label}, ${open}` : label}
              testID={`tab-${route.name}`}
            >
              <View style={[styles.iconWrap, on && styles.iconWrapOn]}>
                <Icon size={24} color={on ? colors.primary : colors.textFaint} />
                {route.name === 'alerts' && open > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{open > 9 ? '9+' : open}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.label, on && styles.labelOn]} numberOfLines={2}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.surface },
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 6,
    paddingBottom: 8,
  },
  item: { flex: 1, alignItems: 'center', minHeight: 56, justifyContent: 'flex-start', paddingHorizontal: 2 },
  iconWrap: { width: 56, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  iconWrapOn: { backgroundColor: colors.primarySoft },
  label: {
    fontSize: 12.5,
    lineHeight: 16,
    textAlign: 'center',
    fontWeight: '700',
    color: colors.textFaint,
    marginTop: 2,
  },
  labelOn: { color: colors.primary },
  badge: {
    position: 'absolute',
    top: -4,
    end: 6,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
});
