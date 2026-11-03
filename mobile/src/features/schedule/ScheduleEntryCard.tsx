import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { CalendarDays, ChevronRight } from 'lucide-react-native';
import { useGetPumpSchedule } from '@/api/generated/farmer';
import type { PumpResponse } from '@/api/generated/model';
import { colors, font } from '@/shared/theme';
import { Card, CardTitle } from '@/shared/ui/Card';
import { useDirection } from '@/shared/i18n/useDirection';
import { ajantaHome } from '@/config/ajantaHome';
import { nextLabel } from './labels';
import { activeCount } from './model';

/** On the Timer page: what the weekly schedule is doing, and a way in. */
export const ScheduleEntryCard: React.FC<{ pump: PumpResponse }> = ({ pump }) => {
  const { t } = useTranslation();
  const router = useRouter();
  const { flip } = useDirection();
  const schedule = useGetPumpSchedule(pump.id).data;

  const count = schedule ? activeCount(schedule.entries) : 0;
  const summary = !schedule || schedule.entries.length === 0
    ? t('schedule.cardNone')
    : schedule.enabled
      ? t('schedule.cardOn', { count })
      : t('schedule.cardOff');

  const next = schedule?.enabled ? nextLabel(schedule.next, t) : null;

  if (ajantaHome) {
    return (
      <Pressable
        testID="schedule-entry"
        style={styles.ajanta}
        onPress={() => router.push('/schedule')}
        accessibilityRole="button"
        accessibilityLabel={`${t('schedule.title')}. ${summary}`}
      >
        <View style={styles.ajantaIcon}>
          <CalendarDays size={28} color="#1565C0" />
        </View>
        <View style={styles.ajantaText}>
          <Text style={styles.ajantaTitle}>{t('schedule.title')}</Text>
          <Text style={styles.ajantaSummary}>{summary}</Text>
          {next ? <Text style={styles.ajantaNext}>{next}</Text> : null}
        </View>
        <ChevronRight size={24} color="#94A3B8" style={flip} />
      </Pressable>
    );
  }

  return (
    <Pressable
      testID="schedule-entry"
      onPress={() => router.push('/schedule')}
      accessibilityRole="button"
      accessibilityLabel={`${t('schedule.title')}. ${summary}`}
    >
      <Card>
        <CardTitle icon={CalendarDays} title={t('schedule.title')} right={<ChevronRight size={24} color={colors.textMuted} style={flip} />} />
        <Text style={styles.summary}>{summary}</Text>
        {next ? <Text style={styles.next}>{next}</Text> : null}
      </Card>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  ajanta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E6ECF2',
    padding: 12,
  },
  ajantaIcon: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#E3EEFF', alignItems: 'center', justifyContent: 'center' },
  ajantaText: { flex: 1, minWidth: 0 },
  ajantaTitle: { color: '#14213D', fontSize: 19, fontWeight: '900' },
  ajantaSummary: { color: '#5B6B80', fontSize: 14, marginTop: 2, lineHeight: 20 },
  ajantaNext: { color: '#1253C4', fontSize: 14.5, fontWeight: '800', marginTop: 4 },
  summary: { color: colors.textMuted, fontSize: font.body, lineHeight: 23 },
  next: { color: colors.primaryDark, fontSize: font.bodyLg, fontWeight: '800', marginTop: 8 },
});
