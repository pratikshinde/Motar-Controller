import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Plus, Trash2 } from 'lucide-react-native';
import { getGetPumpScheduleQueryKey, setPumpSchedule, useGetPumpSchedule } from '@/api/generated/farmer';
import type { PumpResponse } from '@/api/generated/model';
import { colors, font, radius, TOUCH } from '@/shared/theme';
import { Banner } from '@/shared/ui/Banner';
import { BigActionButton } from '@/shared/ui/BigActionButton';
import { Card, CardTitle } from '@/shared/ui/Card';
import { ConfirmSheet } from '@/shared/ui/ConfirmSheet';
import { StateView } from '@/shared/ui/StateView';
import { SwatiPage } from '@/shared/ui/SwatiPage';
import { friendlyError } from '@/shared/i18n/errors';
import { useOnline } from '@/shared/hooks/useOnline';
import { canControl, displayName } from '@/features/pumps/model';
import { useCurrentPump } from '@/features/pumps/useCurrentPump';
import { TimePickerSheet } from './TimePickerSheet';
import { ajantaHome } from '@/config/ajantaHome';
import { RecentRuns } from './RecentRuns';
import { SimpleScheduleEditor } from './ScheduleSimple';
import { dayName, lengthLabel, nextLabel, timeLabel } from './labels';
import {
  DAY_KEYS, DEFAULT_LIMITS, Row, RowProblem, entriesFromRows, newRowFor, rowsFromEntries, simpleWindowOf, validateRows,
} from './model';

/**
 * The weekly schedule of Swati's app: for each day of the week, the times the pump should switch on and off by
 * itself ("Monday 11:00 AM on, 1:00 PM off"). The cloud keeps the calendar and sends the start and stop (the controller
 * has no clock), so the pump must be online at those times; the screen says so rather than promising more.
 */
export const ScheduleScreen: React.FC = () => {
  const { t } = useTranslation();
  const { pump, loading, failed, refetch } = useCurrentPump();
  return (
    <SwatiPage title={t('schedule.title')}>
      {loading ? (
        <StateView kind="loading" title={t('common.loading')} />
      ) : failed ? (
        <StateView kind="error" title={t('common.serverUnreachableTitle')} actionLabel={t('common.retry')} onAction={refetch} />
      ) : pump ? (
        ajantaHome ? <AjantaSchedule pump={pump} /> : <ScheduleEditor pump={pump} />
      ) : (
        <StateView kind="empty" title={t('pumps.emptyTitle')} message={t('pumps.emptyMessage')} />
      )}
    </SwatiPage>
  );
};

/**
 * Ajanta opens the simple page (one start, one stop, the days) whenever the saved schedule can be said that way, and the detailed
 * page (times for each day) when it cannot, or when the farmer asks for it.
 */
export const AjantaSchedule: React.FC<{ pump: PumpResponse }> = ({ pump }) => {
  const { t } = useTranslation();
  const query = useGetPumpSchedule(pump.id, { query: { refetchInterval: 30_000 } });
  const data = query.data;
  const [detailed, setDetailed] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  // Decided once, from the first schedule that arrives: later refreshes must not flip the page under the farmer's fingers.
  if (data && detailed === null) setDetailed(simpleWindowOf(rowsFromEntries(data.entries)) === null);

  // A failed first load hands over to the detailed editor (it shows the error and a retry) and stays there. It must be sticky: a
  // retry puts the query back to "loading", and swapping the two pages on every state change would re-fetch without end.
  if (query.isError && !failed) setFailed(true);
  if (!data) return failed ? <ScheduleEditor pump={pump} /> : <StateView kind="loading" title={t('common.loading')} />;
  if (detailed === null || detailed) return <ScheduleEditor pump={pump} />;
  return <SimpleScheduleEditor pump={pump} data={data} onDetailed={() => setDetailed(true)} />;
};

const problemText = (p: RowProblem, t: ReturnType<typeof useTranslation>['t']): string => {
  switch (p.kind) {
    case 'order': return t('schedule.errOrder');
    case 'short': return t('schedule.errShort', { min: p.minutes });
    case 'overlap': return t('schedule.errOverlap');
    default: return t('schedule.errGap', { min: p.minutes });
  }
};

export const ScheduleEditor: React.FC<{ pump: PumpResponse }> = ({ pump }) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const online = useOnline();
  const query = useGetPumpSchedule(pump.id, { query: { refetchInterval: 30_000 } });
  const data = query.data;
  const limits = data?.limits ?? DEFAULT_LIMITS;

  const [enabled, setEnabled] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);
  const [picking, setPicking] = useState<{ key: string; field: 'on' | 'off' } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Show what the server has, and keep showing it fresh, but never throw away what the farmer is in the middle of editing.
  const seeded = useRef<unknown>(null);
  useEffect(() => {
    if (data && !dirty && seeded.current !== data) {
      seeded.current = data;
      setEnabled(data.enabled);
      setRows(rowsFromEntries(data.entries));
    }
  }, [data, dirty]);

  const problems = useMemo(() => validateRows(rows, limits), [rows, limits]);
  const hasProblems = Object.keys(problems).length > 0;
  const blocked = !canControl(pump) || !online;
  const name = displayName(pump);

  const change = (fn: () => void) => {
    fn();
    setDirty(true);
    setSavedAt(null);
  };
  const edit = (key: string, patch: Partial<Row>) => change(() => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r))));
  const add = (day: number) => change(() => setRows((rs) => [...rs, newRowFor(day, rs)]));
  const remove = (key: string) => change(() => setRows((rs) => rs.filter((r) => r.key !== key)));

  const send = async () => {
    setSending(true);
    try {
      const saved = await setPumpSchedule(pump.id, { enabled, entries: entriesFromRows(rows) });
      qc.setQueryData(getGetPumpScheduleQueryKey(pump.id), saved);
      seeded.current = saved;
      setEnabled(saved.enabled);
      setRows(rowsFromEntries(saved.entries));
      setDirty(false);
      setFailure(null);
      setSavedAt(Date.now());
    } catch (err) {
      setFailure(err);
    } finally {
      setSending(false);
      setConfirming(false);
    }
  };

  const pickingRow = picking ? rows.find((r) => r.key === picking.key) : undefined;
  const next = data?.enabled && !dirty ? nextLabel(data.next, t) : null;

  return (
    <View style={styles.stack}>
      {!canControl(pump) ? <Banner tone="danger" text={t('schedule.remoteBlocked')} /> : null}
      {!online ? <Banner tone="warn" text={t('command.offlineBlock')} /> : null}
      {query.isError && !data ? (
        <Banner tone="danger" text={friendlyError(query.error, t, 'load')} actionLabel={t('common.retry')} onAction={() => void query.refetch()} />
      ) : null}

      <Card>
        <CardTitle
          icon={CalendarDays}
          title={t('schedule.master')}
          right={
            <Switch
              testID="schedule-master"
              value={enabled}
              onValueChange={(v) => change(() => setEnabled(v))}
              disabled={blocked}
              accessibilityLabel={t('schedule.master')}
              trackColor={{ false: colors.borderStrong, true: colors.primary }}
              thumbColor="#FFFFFF"
            />
          }
        />
        <Text style={styles.intro}>{t('schedule.intro')}</Text>
        {next ? <Text style={styles.next} testID="schedule-next">{next}</Text> : null}
      </Card>

      {DAY_KEYS.map((_, day) => {
        const dayRows = rows.filter((r) => r.day === day).sort((a, b) => (a.on < b.on ? -1 : 1));
        return (
          <Card key={day}>
            <View style={styles.dayHead}>
              <Text style={styles.dayName} accessibilityRole="header">{dayName(day, t)}</Text>
              <Pressable
                testID={`schedule-add-${DAY_KEYS[day]}`}
                onPress={() => add(day)}
                disabled={blocked || rows.length >= limits.max_rows}
                accessibilityRole="button"
                accessibilityLabel={`${t('schedule.addTime')}: ${dayName(day, t)}`}
                style={({ pressed }) => [styles.addBtn, (blocked || pressed) && styles.dim]}
              >
                <Plus size={18} color={colors.primaryDark} />
                <Text style={styles.addText}>{t('schedule.addTime')}</Text>
              </Pressable>
            </View>
            {dayRows.length === 0 ? <Text style={styles.none}>{t('schedule.noTimes')}</Text> : null}
            {dayRows.map((row, i) => {
              const problem = problems[row.key];
              const length = lengthLabel(row.on, row.off, t);
              return (
                <View key={row.key} style={[styles.row, !row.enabled && styles.rowOff]} testID={`schedule-row-${DAY_KEYS[day]}-${i}`}>
                  <View style={styles.times}>
                    <TimeButton
                      testID={`schedule-on-${DAY_KEYS[day]}-${i}`}
                      label={t('schedule.switchOn')}
                      value={timeLabel(row.on, t)}
                      onPress={() => setPicking({ key: row.key, field: 'on' })}
                      invalid={!!problem}
                      disabled={blocked}
                    />
                    <TimeButton
                      testID={`schedule-off-${DAY_KEYS[day]}-${i}`}
                      label={t('schedule.switchOff')}
                      value={timeLabel(row.off, t)}
                      onPress={() => setPicking({ key: row.key, field: 'off' })}
                      invalid={!!problem}
                      disabled={blocked}
                    />
                  </View>
                  <View style={styles.rowFoot}>
                    <Text style={problem ? styles.error : styles.length} testID={`schedule-note-${DAY_KEYS[day]}-${i}`}>
                      {problem ? problemText(problem, t) : length ?? ''}
                    </Text>
                    <View style={styles.tools}>
                      <Switch
                        value={row.enabled}
                        onValueChange={(v) => edit(row.key, { enabled: v })}
                        disabled={blocked}
                        accessibilityLabel={t('schedule.active')}
                        trackColor={{ false: colors.borderStrong, true: colors.primary }}
                        thumbColor="#FFFFFF"
                      />
                      <Pressable
                        testID={`schedule-remove-${DAY_KEYS[day]}-${i}`}
                        onPress={() => remove(row.key)}
                        disabled={blocked}
                        accessibilityRole="button"
                        accessibilityLabel={t('schedule.remove')}
                        style={styles.trash}
                      >
                        <Trash2 size={22} color={colors.danger} />
                      </Pressable>
                    </View>
                  </View>
                </View>
              );
            })}
          </Card>
        );
      })}

      <Banner tone="info" text={t('schedule.notice')} />

      {failure ? <Banner tone="danger" text={friendlyError(failure, t, 'command')} testID="schedule-error" /> : null}
      {savedAt ? <Banner tone="info" text={t('schedule.saved')} testID="schedule-saved" /> : null}

      <BigActionButton
        testID="schedule-save"
        label={t('schedule.save')}
        onPress={() => setConfirming(true)}
        disabled={blocked || !dirty || hasProblems}
      />

      {data ? <RecentRuns recent={data.recent} /> : null}

      <TimePickerSheet
        visible={picking !== null && pickingRow !== undefined}
        title={picking?.field === 'off' ? t('schedule.pickOff') : t('schedule.pickOn')}
        value={pickingRow ? (picking!.field === 'off' ? pickingRow.off : pickingRow.on) : '06:00'}
        labels={{
          hour: t('schedule.hour'), minute: t('schedule.minute'), am: t('schedule.am'), pm: t('schedule.pm'),
          done: t('schedule.done'), cancel: t('common.cancel'), more: t('common.more'), less: t('common.less'),
        }}
        onCancel={() => setPicking(null)}
        onConfirm={(hhmm) => {
          if (picking) edit(picking.key, picking.field === 'off' ? { off: hhmm } : { on: hhmm });
          setPicking(null);
        }}
      />

      <ConfirmSheet
        visible={confirming}
        title={t('schedule.confirmTitle', { name })}
        message={t('schedule.confirmMessage')}
        confirmLabel={t('schedule.confirmYes')}
        cancelLabel={t('dashboard.no')}
        busy={sending}
        onConfirm={send}
        onCancel={() => setConfirming(false)}
      />
    </View>
  );
};

const TimeButton: React.FC<{
  label: string;
  value: string;
  onPress: () => void;
  invalid: boolean;
  disabled: boolean;
  testID: string;
}> = ({ label, value, onPress, invalid, disabled, testID }) => (
  <Pressable
    testID={testID}
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    accessibilityLabel={`${label}: ${value}`}
    style={({ pressed }) => [styles.timeBtn, invalid && styles.timeBtnBad, (pressed || disabled) && styles.dim]}
  >
    <Text style={styles.timeLabel}>{label}</Text>
    <Text style={styles.timeValue}>{value}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  stack: { gap: 14, paddingBottom: 24 },
  intro: { color: colors.textMuted, fontSize: font.body, lineHeight: 23 },
  next: { color: colors.primaryDark, fontSize: font.bodyLg, fontWeight: '800', marginTop: 12 },
  dayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  dayName: { color: colors.text, fontSize: font.title, fontWeight: '900', flexShrink: 1 },
  addBtn: {
    minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14,
    borderRadius: radius.pill, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primaryBorder,
  },
  addText: { color: colors.primaryDark, fontSize: font.body, fontWeight: '800' },
  dim: { opacity: 0.5 },
  none: { color: colors.textFaint, fontSize: font.body, paddingVertical: 4 },
  row: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, marginTop: 8, gap: 10 },
  rowOff: { opacity: 0.55 },
  times: { flexDirection: 'row', gap: 10 },
  timeBtn: {
    flex: 1, minHeight: TOUCH, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.borderStrong,
    backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 8, justifyContent: 'center',
  },
  timeBtnBad: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  timeLabel: { color: colors.textMuted, fontSize: font.caption, fontWeight: '800' },
  timeValue: { color: colors.text, fontSize: font.title, fontWeight: '900' },
  rowFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  length: { color: colors.textMuted, fontSize: font.body, fontWeight: '700', flexShrink: 1 },
  error: { color: colors.danger, fontSize: font.body, fontWeight: '800', flexShrink: 1 },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  trash: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
