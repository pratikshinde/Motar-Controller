import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

/**
 * Tells TanStack Query when the phone is online and when the app is in the foreground.
 * On a phone that is NetInfo and AppState; in a browser TanStack's own online/offline and
 * visibility listeners already do the job, so they are left alone.
 */
export function setupQueryLifecycle(): () => void {
  if (Platform.OS === 'web') return () => undefined;
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => setOnline(state.isConnected !== false && state.isInternetReachable !== false)),
  );
  const sub = AppState.addEventListener('change', (status) => focusManager.setFocused(status === 'active'));
  return () => sub.remove();
}
