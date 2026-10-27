import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Home, Clock, Menu } from 'lucide-react-native';

const ITEMS: Record<
  string,
  { labelKey: string; Icon: React.ComponentType<{ size?: number; color?: string }> }
> = {
  index: { labelKey: 'nav.home', Icon: Home },
  timer: { labelKey: 'nav.timer', Icon: Clock },
  settings: { labelKey: 'nav.more', Icon: Menu },
};

export interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: {
    emit: (event: { type: string; target: string; canPreventDefault?: boolean }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
}

export const TabBarSwati: React.FC<TabBarProps> = ({ state, navigation }) => {
  const { t } = useTranslation();

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
              activeOpacity={0.78}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={label}
              testID={`tab-${route.name}`}
            >
              <View style={[styles.iconWrap, on && styles.iconWrapOn]}>
                <Icon size={22} color={on ? '#0D47A1' : '#64748B'} />
              </View>
              <Text style={[styles.label, on && styles.labelOn]} numberOfLines={1}>
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
  safe: {
    backgroundColor: '#FFFFFF',
  },
  bar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1.5,
    borderTopColor: '#E2E8F0',
    paddingTop: 8,
    paddingBottom: 6,
    elevation: 12,
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  iconWrap: {
    width: 52,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapOn: {
    backgroundColor: '#E0F2FE',
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    marginTop: 3,
  },
  labelOn: {
    color: '#0D47A1',
    fontWeight: '900',
  },
});
