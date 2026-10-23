import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from 'lucide-react-native';
import { colors } from '@/shared/theme';
import { useDirection } from '@/shared/i18n/useDirection';

interface Props {
  title: string;
  /** Something small on the right of the header (a button). */
  right?: React.ReactNode;
  /** Hide the back arrow (the page is one of the main tabs). */
  noBack?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  children: React.ReactNode;
}

/** The frame of Swati's secondary pages: header with back arrow and a scrolling body on a light background. */
export const SwatiPage: React.FC<Props> = ({ title, right, noBack, refreshing, onRefresh, children }) => {
  const { t } = useTranslation();
  const router = useRouter();
  const { flip } = useDirection();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <View style={styles.side}>
          {noBack ? null : (
            <TouchableOpacity
              onPress={back}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
              activeOpacity={0.7}
            >
              <ChevronLeft size={28} color="#0F172A" style={flip} />
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        <View style={[styles.side, { alignItems: 'flex-end' }]}>{right}</View>
      </View>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[colors.primary]} /> : undefined}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F8FAFC' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    minHeight: 56,
  },
  side: { minWidth: 44 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 20, fontWeight: '800', color: '#0F172A' },
  scroll: { padding: 16, gap: 16, paddingBottom: 32 },
});
