import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { colors, font, radius, space, TOUCH } from '@/shared/theme';
import { BigActionButton } from '@/shared/ui/BigActionButton';
import { display12h, from12h, pad, to12h } from './model';

/**
 * Picks a time of day with big up / down buttons: hour, minute (steps of 5) and AM / PM. No wheel or clock face to
 * scroll with a gloved or wet thumb, and no native picker module (so it works the same in every build and in tests).
 */
type Labels = { hour: string; minute: string; am: string; pm: string; done: string; cancel: string; more: string; less: string };

export const TimePickerSheet: React.FC<{
  visible: boolean;
  title: string;
  /** "HH:MM", 24-hour */
  value: string;
  labels: Labels;
  onConfirm: (hhmm: string) => void;
  onCancel: () => void;
}> = ({ visible, title, value, labels, onConfirm, onCancel }) => (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityLabel={labels.cancel} accessibilityRole="button" />
      {/* Mounted only while open, so it starts from the row's own time every time, with no effect to reset it. */}
      {visible ? <PickerBody title={title} value={value} labels={labels} onConfirm={onConfirm} onCancel={onCancel} /> : null}
    </View>
  </Modal>
);

const PickerBody: React.FC<{
  title: string;
  value: string;
  labels: Labels;
  onConfirm: (hhmm: string) => void;
  onCancel: () => void;
}> = ({ title, value, labels, onConfirm, onCancel }) => {
  const start = to12h(value);
  const [hour, setHour] = useState(start.hour);
  const [minute, setMinute] = useState(start.minute);
  const [pm, setPm] = useState(start.pm);

  const hourUp = () => setHour((h) => (h % 12) + 1);
  const hourDown = () => setHour((h) => (h === 1 ? 12 : h - 1));
  const minuteUp = () => setMinute((m) => (Math.floor(m / 5) * 5 + 5) % 60);
  const minuteDown = () => setMinute((m) => (m % 5 === 0 ? (m + 55) % 60 : Math.floor(m / 5) * 5));

  const current = from12h(hour, minute, pm);

  return (
    <View style={styles.sheet} accessibilityViewIsModal>
      <View style={styles.grabber} />
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.preview} testID="time-preview">
        {display12h(current, labels.am, labels.pm)}
      </Text>

      <View style={styles.columns}>
        <Stepper
          label={labels.hour}
          text={String(hour)}
          onUp={hourUp}
          onDown={hourDown}
          upLabel={`${labels.hour} ${labels.more}`}
          downLabel={`${labels.hour} ${labels.less}`}
          testID="time-hour"
        />
        <Stepper
          label={labels.minute}
          text={pad(minute)}
          onUp={minuteUp}
          onDown={minuteDown}
          upLabel={`${labels.minute} ${labels.more}`}
          downLabel={`${labels.minute} ${labels.less}`}
          testID="time-minute"
        />
        <View style={styles.ampm}>
          <Text style={styles.colLabel}> </Text>
          {[
            { label: labels.am, active: !pm, set: false, id: 'time-am' },
            { label: labels.pm, active: pm, set: true, id: 'time-pm' },
          ].map((o) => (
            <Pressable
              key={o.id}
              testID={o.id}
              onPress={() => setPm(o.set)}
              accessibilityRole="button"
              accessibilityState={{ selected: o.active }}
              style={[styles.ampmBtn, o.active && styles.ampmActive]}
            >
              <Text style={[styles.ampmText, o.active && styles.ampmTextActive]}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.actions}>
        <BigActionButton label={labels.done} onPress={() => onConfirm(current)} testID="time-done" />
        <BigActionButton label={labels.cancel} onPress={onCancel} tone="neutral" testID="time-cancel" />
      </View>
    </View>
  );
};

const Stepper: React.FC<{
  label: string;
  text: string;
  onUp: () => void;
  onDown: () => void;
  upLabel: string;
  downLabel: string;
  testID: string;
}> = ({ label, text, onUp, onDown, upLabel, downLabel, testID }) => (
  <View style={styles.stepper}>
    <Text style={styles.colLabel}>{label}</Text>
    <Pressable testID={`${testID}-up`} onPress={onUp} accessibilityRole="button" accessibilityLabel={upLabel} style={styles.stepBtn}>
      <ChevronUp size={28} color={colors.primaryDark} />
    </Pressable>
    <Text style={styles.stepValue} testID={`${testID}-value`}>
      {text}
    </Text>
    <Pressable testID={`${testID}-down`} onPress={onDown} accessibilityRole="button" accessibilityLabel={downLabel} style={styles.stepBtn}>
      <ChevronDown size={28} color={colors.primaryDark} />
    </Pressable>
  </View>
);

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(13,43,32,0.55)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: space.xl,
    paddingBottom: 28,
    gap: 12,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 4 },
  title: { color: colors.text, fontSize: font.title, fontWeight: '900', textAlign: 'center' },
  preview: { color: colors.primaryDark, fontSize: font.display, fontWeight: '900', textAlign: 'center' },
  columns: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', gap: 14, marginTop: 4 },
  stepper: { alignItems: 'center', gap: 6, flex: 1 },
  colLabel: { color: colors.textMuted, fontSize: font.caption, fontWeight: '800' },
  stepBtn: {
    width: '100%',
    minHeight: TOUCH,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { color: colors.text, fontSize: 38, fontWeight: '900', lineHeight: 46 },
  ampm: { flex: 1, gap: 8, alignItems: 'stretch' },
  ampmBtn: {
    minHeight: TOUCH,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ampmActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  ampmText: { color: colors.text, fontSize: font.bodyLg, fontWeight: '900' },
  ampmTextActive: { color: colors.textOnPrimary },
  actions: { gap: 10, marginTop: 8 },
});
