import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Clock, Play, Square } from 'lucide-react-native';
import { getGetPumpScheduleQueryKey, setPumpSchedule } from '@/api/generated/farmer';
import type { PumpResponse, ScheduleOut } from '@/api/generated/model';
import { colors, font, radius, TOUCH } from '@/shared/theme';
import { Banner } from '@/shared/ui/Banner';
import { BigActionButton } from '@/shared/ui/BigActionButton';
import { Card, CardTitle } from '@/shared/ui/Card';
import { ConfirmSheet } from '@/shared/ui/ConfirmSheet';
import { friendlyError } from '@/shared/i18n/errors';
import { useOnline } from '@/shared/hooks/useOnline';
import { canControl, displayName } from '@/features/pumps/model';
import { RecentRuns } from './RecentRuns';
import { TimePickerSheet } from './TimePickerSheet';
import { dayShort, lengthLabel, nextLabel } from './labels';
import { hasNativeTimePicker, openNativeTimePicker } from './nativeTimePicker';
import {
  DAY_KEYS, DEFAULT_LIMITS, DEFAULT_SIMPLE, SimpleWindow, clock12h, entriesFromRows, rowsFromEntries, rowsFromWindow,
  simpleWindowOf, validateRows,
} from './model';

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

type Field = 'on' | 'off';

/**
 * Ajanta's schedule page: one Start time and one Stop time (picked on the phone's own clock), repeated on the chosen days.
 * It saves through the same weekly schedule as the detailed editor (`setPumpSchedule`: one row per chosen day). A schedule that
 * cannot be said this simply is opened in the detailed editor instead, so nothing saved is ever lost here.
 */
export const SimpleScheduleEditor: React.FC<{ pump: PumpResponse; data: ScheduleOut; onDetailed: () => void }> = ({ pump, data, onDetailed }) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const online = useOnline();
  const limits = data.limits ?? DEFAULT_LIMITS;
  const name = displayName(pump);
  const blocked = !canControl(pump) || !online;

  const [enabled, setEnabled] = useState(data.enabled);
  const [win, setWin] = useState<SimpleWindow>(() => simpleWindowOf(rowsFromEntries(data.entries)) ?? { ...DEFAULT_SIMPLE, days: [] });
  const [dirty, setDirty] = useState(false);
  const [sheet, setSheet] = useState<Field | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Keep showing what the server has, but never throw away what the farmer is in the middle of changing.
  const [seen, setSeen] = useState<ScheduleOut>(data);
  if (!dirty && seen !== data) {
    setSeen(data);
    setEnabled(data.enabled);
    const w = simpleWindowOf(rowsFromEntries(data.entries));
    if (w) setWin(w);
  }

  const touch = () => {
    setDirty(true);
    setSavedAt(null);
  };
  const setTime = (field: Field, hhmm: string) => {
    setWin((w) => ({ ...w, [field]: hhmm }));
    touch();
  };
  // Choosing the first day of a schedule that was never switched on means "I want this": switch it on, so Save does what the farmer expects.
  const switchOnForFirstDay = () => {
    if (win.days.length === 0 && data.entries.length === 0) setEnabled(true);
  };
  const toggleDay = (day: number) => {
    switchOnForFirstDay();
    setWin((w) => ({ ...w, days: w.days.includes(day) ? w.days.filter((d) => d !== day) : [...w.days, day].sort((a, b) => a - b) }));
    touch();
  };
  const everyDay = win.days.length === 7;
  const setEveryDay = () => {
    switchOnForFirstDay();
    setWin((w) => ({ ...w, days: everyDay ? [] : ALL_DAYS }));
    touch();
  };

  const openPicker = (field: Field) => {
    if (blocked) return;
    if (hasNativeTimePicker()) openNativeTimePicker(win[field], (hhmm) => setTime(field, hhmm));
    else setSheet(field);
  };

  const am = t('schedule.am');
  const pm = t('schedule.pm');
  const rows = useMemo(() => rowsFromWindow(win), [win]);
  // The two times are checked on their own (before a day is even chosen), so a wrong pair shows at once.
  const orderProblem = useMemo(
    () => validateRows([{ key: 'x', day: 0, on: win.on, off: win.off, enabled: true }], limits).x,
    [win.on, win.off, limits],
  );
  const problemText = orderProblem
    ? orderProblem.kind === 'order' ? t('schedule.errOrder') : t('schedule.errShort', { min: orderProblem.minutes })
    : null;
  const noDays = win.days.length === 0;
  const length = lengthLabel(win.on, win.off, t);
  const next = data.enabled && !dirty ? nextLabel(data.next, t) : null;

  const send = async () => {
    setSending(true);
    try {
      const saved = await setPumpSchedule(pump.id, { enabled, entries: entriesFromRows(rows) });
      qc.setQueryData(getGetPumpScheduleQueryKey(pump.id), saved);
      setSeen(saved);
      setEnabled(saved.enabled);
      const w = simpleWindowOf(rowsFromEntries(saved.entries));
      if (w) setWin(w);
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

  return (
    <View style={styles.stack}>
      {!canControl(pump) ? <Banner tone="danger" text={t('schedule.remoteBlocked')} /> : null}
      {!online ? <Banner tone="warn" text={t('command.offlineBlock')} /> : null}

      <Card>
        <CardTitle
          icon={CalendarDays}
          title={t('schedule.master')}
          right={
            <Switch
              testID="schedule-master"
              value={enabled}
              onValueChange={(v) => {
                setEnabled(v);
                touch();
              }}
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

      <View style={styles.cards}>
        <TimeCard
          testID="schedule-start"
          kind="start"
          label={t('schedule.startTime')}
          value={clock12h(win.on, am, pm)}
          hint={t('schedule.tapToChange')}
          invalid={!!problemText}
          disabled={blocked}
          onPress={() => openPicker('on')}
        />
        <TimeCard
          testID="schedule-stop"
          kind="stop"
          label={t('schedule.stopTime')}
          value={clock12h(win.off, am, pm)}
          hint={t('schedule.tapToChange')}
          invalid={!!problemText}
          disabled={blocked}
          onPress={() => openPicker('off')}
        />
      </View>

      <Card>
        <View style={styles.repeatHead}>
          <Text style={styles.repeatTitle} accessibilityRole="header">{t('schedule.repeatOn')}</Text>
          <Pressable
            testID="schedule-every-day"
            onPress={setEveryDay}
            disabled={blocked}
            accessibilityRole="button"
            accessibilityState={{ selected: everyDay }}
            style={[styles.everyDay, everyDay && styles.everyDayOn, blocked && styles.dim]}
          >
            <Text style={[styles.everyDayText, everyDay && styles.everyDayTextOn]}>{t('schedule.everyDay')}</Text>
          </Pressable>
        </View>
        <View style={styles.days}>
          {DAY_KEYS.map((key, day) => {
            const on = win.days.includes(day);
            return (
              <Pressable
                key={key}
                testID={`schedule-day-${key}`}
                onPress={() => toggleDay(day)}
                disabled={blocked}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={t(`schedule.day.${key}`)}
                style={[styles.day, on && styles.dayOn, blocked && styles.dim]}
              >
                <Text style={[styles.dayText, on && styles.dayTextOn]} numberOfLines={1}>{dayShort(day, t)}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <View style={[styles.summary, problemText && styles.summaryBad]}>
        <Clock size={22} color={problemText ? colors.danger : colors.primary} />
        <View style={styles.summaryText}>
          {problemText ? (
            <Text style={[styles.summaryMain, { color: colors.danger }]} testID="schedule-problem" accessibilityRole="alert">{problemText}</Text>
          ) : (
            <>
              <Text style={styles.summaryMain} testID="schedule-summary">
                {t('schedule.summary', { on: clock12h(win.on, am, pm), off: clock12h(win.off, am, pm) })}
              </Text>
              {length ? <Text style={styles.summarySub}>{length}</Text> : null}
            </>
          )}
          {noDays && !problemText ? <Text style={styles.summaryNote} testID="schedule-no-days">{t('schedule.chooseDay')}</Text> : null}
        </View>
      </View>

      <Banner tone="info" text={t('schedule.notice')} />
      {failure ? <Banner tone="danger" text={friendlyError(failure, t, 'command')} testID="schedule-error" /> : null}
      {savedAt ? <Banner tone="info" text={t('schedule.saved')} testID="schedule-saved" /> : null}

      <BigActionButton
        testID="schedule-save"
        label={t('schedule.save')}
        onPress={() => setConfirming(true)}
        disabled={blocked || !dirty || !!problemText || noDays}
        loading={sending}
      />

      <Pressable onPress={onDetailed} accessibilityRole="button" style={styles.link} testID="schedule-detailed">
        <Text style={styles.linkText}>{t('schedule.perDay')}</Text>
      </Pressable>

      <RecentRuns recent={data.recent} />

      {/* Phones without the native clock (iPhone, the web preview) use the app's own picker. */}
      <TimePickerSheet
        visible={sheet !== null}
        title={sheet === 'off' ? t('schedule.pickOff') : t('schedule.pickOn')}
        value={sheet ? win[sheet] : win.on}
        labels={{
          hour: t('schedule.hour'), minute: t('schedule.minute'), am, pm,
          done: t('schedule.done'), cancel: t('common.cancel'), more: t('common.more'), less: t('common.less'),
        }}
        onCancel={() => setSheet(null)}
        onConfirm={(hhmm) => {
          if (sheet) setTime(sheet, hhmm);
          setSheet(null);
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

/** One big time card: a coloured icon (green play for Start, red stop for Stop), its name, the chosen time, and "tap to change". */
const TimeCard: React.FC<{
  kind: 'start' | 'stop';
  label: string;
  value: string;
  hint: string;
  invalid: boolean;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}> = ({ kind, label, value, hint, invalid, disabled, onPress, testID }) => {
  const tone = kind === 'start' ? colors.ok : colors.danger;
  const soft = kind === 'start' ? colors.okSoft : colors.dangerSoft;
  const Icon = kind === 'start' ? Play : Square;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityHint={hint}
      style={({ pressed }) => [styles.timeCard, { borderColor: invalid ? colors.danger : soft }, (pressed || disabled) && styles.dim]}
    >
      <View style={[styles.timeIcon, { backgroundColor: tone }]}>
        <Icon size={22} color="#FFFFFF" fill="#FFFFFF" />
      </View>
      <Text style={styles.timeLabel}>{label}</Text>
      <Text style={[styles.timeValue, invalid && { color: colors.danger }]} adjustsFontSizeToFit numberOfLines={1} testID={`${testID}-value`}>
        {value}
      </Text>
      <View style={[styles.timeHint, { backgroundColor: soft }]}>
        <Clock size={14} color={tone} />
        <Text style={[styles.timeHintText, { color: tone }]}>{hint}</Text>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  stack: { gap: 14, paddingBottom: 24 },
  intro: { color: colors.textMuted, fontSize: font.body, lineHeight: 23 },
  next: { color: colors.primary, fontSize: font.bodyLg, fontWeight: '800', marginTop: 12 },
  dim: { opacity: 0.5 },
  cards: { flexDirection: 'row', gap: 12 },
  timeCard: {
    flex: 1, minHeight: 176, borderRadius: radius.xl, borderWidth: 2, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', gap: 6, padding: 12,
  },
  timeIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  timeLabel: { color: colors.textMuted, fontSize: font.body, fontWeight: '800' },
  timeValue: { color: colors.text, fontSize: 28, fontWeight: '900', maxWidth: '100%' },
  timeHint: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  timeHintText: { fontSize: font.caption, fontWeight: '800' },
  repeatHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 },
  repeatTitle: { color: colors.text, fontSize: font.title, fontWeight: '900', flexShrink: 1 },
  everyDay: {
    minHeight: 40, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.primaryBorder,
    backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
  },
  everyDayOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  everyDayText: { color: colors.primary, fontSize: font.body, fontWeight: '800' },
  everyDayTextOn: { color: '#FFFFFF' },
  days: { flexDirection: 'row', gap: 6 },
  day: {
    flex: 1, minHeight: TOUCH, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.borderStrong,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  dayOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayText: { color: colors.text, fontSize: 12.5, fontWeight: '800' },
  dayTextOn: { color: '#FFFFFF' },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.primarySoft, borderRadius: radius.lg, padding: 14 },
  summaryBad: { backgroundColor: colors.dangerSoft },
  summaryText: { flex: 1, gap: 2 },
  summaryMain: { color: colors.text, fontSize: font.bodyLg, fontWeight: '800', lineHeight: 24 },
  summarySub: { color: colors.textMuted, fontSize: font.body, fontWeight: '700' },
  summaryNote: { color: colors.warn, fontSize: font.body, fontWeight: '800', marginTop: 4 },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  linkText: { color: colors.primary, fontSize: font.body, fontWeight: '800', textDecorationLine: 'underline' },
});
