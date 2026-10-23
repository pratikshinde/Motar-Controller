import { Platform } from 'react-native';

const LOCAL_SERVER = Platform.select({
  android: 'http://10.0.2.2:5000',
  default: 'http://localhost:5000',
});

/** Server origin. Override per build with EXPO_PUBLIC_API_URL (e.g. an HTTPS domain). */
export const API_ORIGIN: string =
  process.env.EXPO_PUBLIC_API_URL || LOCAL_SERVER;

export const API_BASE_URL = `${API_ORIGIN}/api/v1`;
export const WS_URL = `${API_ORIGIN.replace(/^http/, 'ws')}/ws`;

/** A pump that has not reported for this long is shown as offline. */
export const OFFLINE_AFTER_MS = 10 * 60 * 1000;
/** Show a "not confirmed" state if the pump has not confirmed a command within this time. */
export const COMMAND_CONFIRM_MS = 60 * 1000;
