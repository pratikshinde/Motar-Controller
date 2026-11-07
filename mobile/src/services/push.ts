import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { brand } from '@/config/brand';
import { httpRequest } from '@/api/http';

/**
 * Push notifications through Firebase Cloud Messaging: the phone asks for permission, gets its registration token and gives it
 * to the backend, which then pushes "pump offline", "back online" and "pump stopped" messages. Only the Ajanta Android app
 * has a Firebase project (app.config.js adds it only when google-services.json is present); everywhere else this does nothing.
 * Push is best effort: any failure here must never get in the way of using the app.
 */
export const pushSupported = Platform.OS === 'android' && brand.key === 'ajanta';

export const ALERTS_CHANNEL = 'alerts';

let registeredToken: string | null = null;

/** Notifications that arrive while the app is open are shown too (a pump stopping is worth a banner). */
export function setupNotificationHandling(): void {
  if (!pushSupported) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

async function sendToken(token: string): Promise<void> {
  await httpRequest({ url: '/auth/me/push-token', method: 'POST', data: { token, platform: 'android' } });
  registeredToken = token;
}

/** Asks for permission (Android 13 and later), then registers this phone with the backend. Safe to call again after every sign-in. */
export async function registerPush(): Promise<void> {
  if (!pushSupported) return;
  try {
    await Notifications.setNotificationChannelAsync(ALERTS_CHANNEL, {
      name: 'Pump alerts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') return;
    const { data } = await Notifications.getDevicePushTokenAsync();
    if (typeof data === 'string' && data.length >= 20) await sendToken(data);
  } catch {
    // No Firebase on this build, no network, or the user said no: the app works the same without notifications.
  }
}

/** The phone's token changed (Firebase rotates it now and then): tell the backend. */
export function onPushTokenChanged(): () => void {
  if (!pushSupported) return () => undefined;
  const sub = Notifications.addPushTokenListener(({ data }) => {
    if (typeof data === 'string' && data.length >= 20) void sendToken(data).catch(() => undefined);
  });
  return () => sub.remove();
}

/** Signing out: this phone stops getting this person's notifications. Call before the session is cleared. */
export async function unregisterPush(): Promise<void> {
  if (!pushSupported || !registeredToken) return;
  const token = registeredToken;
  registeredToken = null;
  try {
    await httpRequest({ url: '/auth/me/push-token', method: 'DELETE', data: { token, platform: 'android' } });
  } catch {
    // Offline: the backend drops the token itself when Firebase says the phone is gone.
  }
}

/** The pump a tapped notification is about, or null. */
export function pumpOfNotification(response: Notifications.NotificationResponse | null): string | null {
  const id = response?.notification.request.content.data?.pump_id;
  return typeof id === 'string' && id ? id : null;
}
