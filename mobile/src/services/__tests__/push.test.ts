import * as Notifications from 'expo-notifications';
import { pumpOfNotification, pushSupported, registerPush, unregisterPush } from '../push';

const response = (data: Record<string, unknown>) =>
  ({ notification: { request: { content: { data } } } }) as unknown as Notifications.NotificationResponse;

describe('push notifications', () => {
  it('opens the pump a tapped notification is about', () => {
    expect(pumpOfNotification(response({ pump_id: 'AJANTA-DEMO-01' }))).toBe('AJANTA-DEMO-01');
  });

  it('ignores a notification with no usable pump', () => {
    expect(pumpOfNotification(response({}))).toBeNull();
    expect(pumpOfNotification(response({ pump_id: 42 }))).toBeNull();
    expect(pumpOfNotification(response({ pump_id: '' }))).toBeNull();
    expect(pumpOfNotification(null)).toBeNull();
  });

  it('does nothing where there is no Firebase (not the Ajanta Android app): no permission prompt, no token', async () => {
    // Jest runs as iOS, so push is off here.
    expect(pushSupported).toBe(false);
    await registerPush();
    await unregisterPush();
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
  });
});
