import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ScheduleOut } from '@/api/generated/model';
import { colors, font, radius, space } from '@/shared/theme';
import { skin } from '@/shared/theme/skin';
import { Card, CardTitle } from '@/shared/ui/Card';
import { momentLabel } from './labels';
import { outcomeOf } from './model';
const TONE: Record<string, { bg: string; fg: string }> = {
  ok: { bg: colors.okSoft, fg: colors.ok },
  info: { bg: skin(colors.primarySoft, colors.waterSoft), fg: skin(colors.primaryDark, '#0B4F9A') },
  warn: { bg: colors.warnSoft, fg: colors.warn },
  bad: { bg: colors.dangerSoft, fg: colors.danger },
  idle: { bg: colors.idleSoft, fg: colors.idle },
};

/** "What happened lately": the last few start / stop times and whether the pump did them. Shown under either schedule editor. */
export const RecentRuns: React.FC<{ recent: ScheduleOut['recent'] }> = ({ recent }) => {
  const { t } = useTranslation();
  if (recent.length === 0) return null;
  return (
    <Card>
      <CardTitle title={t('schedule.recent')} />
      {recent.slice(0, 5).map((run) => {
        const outcome = outcomeOf(run.outcome, run.command_status);
        const tone = TONE[outcome.tone];
        return (
          <View key={`${run.kind}-${run.due_at}`} style={styles.recentRow} testID="schedule-recent">
            <View style={styles.recentText}>
              <Text style={styles.recentWhen}>{momentLabel(run.day_of_week, run.time, t)}</Text>
              <Text style={styles.recentWhat}>{run.kind === 'START' ? t('schedule.switchOn') : t('schedule.switchOff')}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: tone.bg }]}>
              <Text style={[styles.badgeText, { color: tone.fg }]}>{t(`schedule.outcome.${outcome.key}`)}</Text>
            </View>
          </View>
        );
      })}
    </Card>
  );
};

const styles = StyleSheet.create({
  recentRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border,
  },
  recentText: { flexShrink: 1 },
  recentWhen: { color: colors.text, fontSize: font.body, fontWeight: '800' },
  recentWhat: { color: colors.textMuted, fontSize: font.caption, fontWeight: '700' },
  badge: { borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 },
  badgeText: { fontSize: font.caption, fontWeight: '900' },
});
