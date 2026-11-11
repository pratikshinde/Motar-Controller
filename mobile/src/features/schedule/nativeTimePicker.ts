/* eslint-disable @typescript-eslint/no-require-imports */
import { Platform } from 'react-native';
import { pad, toMinutes } from './model';

/** True where the phone's own clock picker exists (Android). Elsewhere (iPhone, the web preview) the app's own picker is used. */
export const hasNativeTimePicker = (): boolean => Platform.OS === 'android';

/** "HH:MM" -> a Date today at that time, which is what the native picker is given. */
const dateAt = (hhmm: string): Date => {
  const minutes = toMinutes(hhmm);
  const d = new Date();
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
};

/**
 * Opens Android's own clock dialog (the round clock face, AM / PM, and the keyboard button for typing the time) at `current`.
 * `onPicked` is called only when the farmer taps OK; Cancel, the back button and a tap outside change nothing.
 * The module is loaded here, not at the top of the file, so a phone or a test without it never loads it.
 */
export function openNativeTimePicker(current: string, onPicked: (hhmm: string) => void): void {
  const { DateTimePickerAndroid } = require('@react-native-community/datetimepicker') as typeof import('@react-native-community/datetimepicker');
  DateTimePickerAndroid.open({
    value: dateAt(current),
    mode: 'time',
    display: 'clock',
    is24Hour: false,
    onChange: (event, date) => {
      if (event.type !== 'set' || !date) return;
      onPicked(`${pad(date.getHours())}:${pad(date.getMinutes())}`);
    },
  });
}
