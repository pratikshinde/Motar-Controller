import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { CalendarDays, ChevronRight } from 'lucide-react-native';
import { useGetPumpSchedule } from '@/api/generated/farmer';
import type { PumpResponse } from '@/api/generated/model';
import { colors, font } from '@/shared/theme';
import { Card, CardTitle } from '@/shared/ui/Card';
import { useDirection } from '@/shared/i18n/useDirection';
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
  summary: { color: colors.textMuted, fontSize: font.body, lineHeight: 23 },
  next: { color: colors.primaryDark, fontSize: font.bodyLg, fontWeight: '800', marginTop: 8 },
});
