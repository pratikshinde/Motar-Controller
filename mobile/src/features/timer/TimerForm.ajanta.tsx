import React from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { Clock, Minus, Pause, Play, Plus, RefreshCw, Timer as TimerIcon } from 'lucide-react-native';
import { TIMER_LIMITS, TimerForm } from './validation';

type Field = keyof TimerForm;

const INK = '#14213D';
const MUTED = '#5B6B80';
const BLUE = '#2F80ED';
const DIAL = 104;
const RADIUS = 44;

/** A round value box: the number is typed into the ring's centre, and the ring fills in step with it. */
const Dial: React.FC<{
  value: string;
  max: number;
  unit: string;
  label: string;
  error: boolean;
  onChange: (v: string) => void;
  testID: string;
}> = ({ value, max, unit, label, error, onChange, testID }) => {
  const n = Number(value);
  const ratio = value !== '' && Number.isFinite(n) ? Math.min(1, Math.max(0, n / max)) : 0;
  const circumference = 2 * Math.PI * RADIUS;
  const angle = ((-90 + 360 * ratio) * Math.PI) / 180;
  const color = error ? '#C62833' : BLUE;
  return (
    <View style={styles.dial}>
      <Svg width={DIAL} height={DIAL} style={StyleSheet.absoluteFill}>
        <Circle cx={DIAL / 2} cy={DIAL / 2} r={RADIUS} stroke="#E3ECF7" strokeWidth={8} fill="#F6F9FD" />
        {ratio > 0 ? (
          <>
            <Circle
              cx={DIAL / 2}
              cy={DIAL / 2}
              r={RADIUS}
              stroke={color}
              strokeWidth={8}
              strokeDasharray={`${circumference * ratio} ${circumference}`}
              strokeLinecap="round"
              fill="none"
              transform={`rotate(-90 ${DIAL / 2} ${DIAL / 2})`}
            />
            <Circle
              cx={DIAL / 2 + RADIUS * Math.cos(angle)}
              cy={DIAL / 2 + RADIUS * Math.sin(angle)}
              r={6}
              fill="#FFFFFF"
              stroke={color}
              strokeWidth={3}
            />
          </>
        ) : null}
      </Svg>
      <TextInput
        testID={testID}
        style={[styles.dialInput, error && { color: '#C62833' }]}
        value={value}
        onChangeText={(v) => onChange(v.replace(/[^\d]/g, '').slice(0, 4))}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={4}
        accessibilityLabel={label}
        selectTextOnFocus
      />
      <Text style={styles.dialUnit}>{unit}</Text>
    </View>
  );
};

const StepButton: React.FC<{ kind: 'less' | 'more'; label: string; onPress: () => void }> = ({ kind, label, onPress }) => (
  <TouchableOpacity style={styles.step} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} activeOpacity={0.7}>
    {kind === 'less' ? <Minus size={20} color="#1565C0" /> : <Plus size={20} color="#1565C0" />}
  </TouchableOpacity>
);

interface Props {
  form: TimerForm;
  errors: Partial<Record<Field, true>>;
  onChange: (f: Field, v: string) => void;
  onStep: (f: Field, delta: number) => void;
  /** "Run 30 min, then stop." or null while the numbers are not valid. */
  summary: string | null;
  saveLabel: string;
  saveDisabled: boolean;
  onSave: () => void;
  /** Banners that belong inside the card (a send that failed, or one that is not confirmed yet). */
  notices?: React.ReactNode;
}

/** The run-timer card of Ajanta's Timer page (the mockup): three round value boxes with their allowed ranges, a summary line and Save. */
export const AjantaTimerForm: React.FC<Props> = ({ form, errors, onChange, onStep, summary, saveLabel, saveDisabled, onSave, notices }) => {
  const { t } = useTranslation();
  const min = t('swati.minShort');

  const rows: {
    field: Field;
    icon: React.ReactNode;
    label: string;
    unit: string;
    max: number;
    range: string;
    extra?: string;
    error: string;
  }[] = [
    {
      field: 'on',
      icon: (
        <View style={[styles.rowIcon, { backgroundColor: '#1BA14F' }]}>
          <Play size={16} color="#FFFFFF" fill="#FFFFFF" />
        </View>
      ),
      label: t('timer.onLabel'),
      unit: min,
      max: TIMER_LIMITS.on.max,
      range: `${t('timer.range', TIMER_LIMITS.on)} ${min}`,
      error: t('timer.errorOn'),
    },
    {
      field: 'off',
      icon: (
        <View style={[styles.rowIcon, { backgroundColor: '#8A97A8' }]}>
          <Pause size={16} color="#FFFFFF" fill="#FFFFFF" />
        </View>
      ),
      label: t('timer.offLabel'),
      unit: min,
      max: TIMER_LIMITS.off.max,
      range: `${t('timer.range', TIMER_LIMITS.off)} ${min}`,
      error: t('timer.errorOff'),
    },
    {
      field: 'cycles',
      icon: <RefreshCw size={26} color="#1565C0" />,
      label: t('timer.cyclesLabel'),
      unit: t('home.timesShort'),
      max: TIMER_LIMITS.cycles.max,
      range: `${t('timer.range', TIMER_LIMITS.cycles)} ${t('home.timesShort')}`,
      extra: t('timer.cyclesHint'),
      error: t('timer.errorCycles'),
    },
  ];

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headIcon}>
          <TimerIcon size={28} color="#159A4B" />
        </View>
        <View style={styles.headText}>
          <Text style={styles.headTitle} accessibilityRole="header">
            {t('timer.title')}
          </Text>
          <Text style={styles.headHint}>{t('timer.intro')}</Text>
        </View>
      </View>

      {rows.map((r) => (
        <View key={r.field} style={styles.fieldBlock}>
          <View style={styles.fieldRow}>
            <View style={styles.labelCol}>
              <View style={styles.labelTop}>
                {r.icon}
                <Text style={styles.label}>{r.label}</Text>
              </View>
              <View style={styles.steps}>
                <StepButton kind="less" label={`${r.label}: ${t('common.less')}`} onPress={() => onStep(r.field, -1)} />
                <StepButton kind="more" label={`${r.label}: ${t('common.more')}`} onPress={() => onStep(r.field, 1)} />
              </View>
            </View>
            <Dial
              testID={`timer-${r.field === 'on' ? 'on' : r.field === 'off' ? 'off' : 'cycles'}`}
              value={form[r.field]}
              max={r.max}
              unit={r.unit}
              label={r.label}
              error={!!errors[r.field]}
              onChange={(v) => onChange(r.field, v)}
            />
            <View style={styles.rangeTile}>
              <Clock size={16} color="#8A97A8" />
              <Text style={styles.rangeText}>{r.range}</Text>
              {r.extra ? <Text style={styles.rangeExtra}>{r.extra}</Text> : null}
            </View>
          </View>
          {errors[r.field] ? (
            <Text style={styles.error} accessibilityRole="alert">
              {r.error}
            </Text>
          ) : null}
        </View>
      ))}

      {summary ? (
        <View style={styles.summary}>
          <View style={[styles.rowIcon, { backgroundColor: '#1BA14F' }]}>
            <Play size={16} color="#FFFFFF" fill="#FFFFFF" />
          </View>
          <Text style={styles.summaryText}>{summary}</Text>
        </View>
      ) : null}
      {notices}
      <TouchableOpacity
        testID="timer-save"
        style={[styles.save, saveDisabled && { opacity: 0.5 }]}
        onPress={onSave}
        disabled={saveDisabled}
        activeOpacity={0.85}
        accessibilityRole="button"
      >
        <Clock size={22} color="#FFFFFF" />
        <Text style={styles.saveText}>{saveLabel}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E6ECF2',
    padding: 12,
    gap: 10,
    elevation: 1,
    shadowColor: '#0D1B2A',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headIcon: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#E3F6EA', alignItems: 'center', justifyContent: 'center' },
  headText: { flex: 1, minWidth: 0 },
  headTitle: { color: INK, fontSize: 19, fontWeight: '900' },
  headHint: { color: MUTED, fontSize: 14, marginTop: 2, lineHeight: 20 },
  fieldBlock: { gap: 4 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  labelCol: { width: 98, gap: 8 },
  labelTop: { gap: 6 },
  label: { color: INK, fontSize: 14.5, fontWeight: '800', lineHeight: 19 },
  rowIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  steps: { flexDirection: 'row', gap: 6 },
  step: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#E7F0FF', alignItems: 'center', justifyContent: 'center' },
  dial: { width: DIAL, height: DIAL, alignItems: 'center', justifyContent: 'center' },
  dialInput: { color: INK, fontSize: 28, fontWeight: '900', textAlign: 'center', minWidth: 64, paddingVertical: 0, marginTop: -6 },
  dialUnit: { color: INK, fontSize: 13, fontWeight: '800', marginTop: -2 },
  rangeTile: { flex: 1, minWidth: 70, backgroundColor: '#F1F6FC', borderRadius: 12, padding: 8, gap: 4 },
  rangeText: { color: MUTED, fontSize: 13.5, fontWeight: '600', lineHeight: 18 },
  rangeExtra: { color: MUTED, fontSize: 12.5, lineHeight: 17 },
  error: { color: '#C62833', fontSize: 14, fontWeight: '700' },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#EAF8EC', borderRadius: 12, padding: 12 },
  summaryText: { flex: 1, color: INK, fontSize: 16, fontWeight: '800', lineHeight: 22 },
  save: {
    minHeight: 56,
    borderRadius: 12,
    backgroundColor: '#1565F0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  saveText: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
});
