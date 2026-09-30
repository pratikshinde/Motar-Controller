import { Alert, Platform } from 'react-native';

/**
 * Yes/no confirmation that works on both phone and web
 * (react-native-web's Alert.alert does nothing, so the web build uses window.confirm).
 */
export function confirmAction(opts: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
}) {
  const { title, message, confirmLabel, cancelLabel, onConfirm } = opts;
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(
    title,
    message,
    [
      { text: cancelLabel, style: 'cancel' },
      { text: confirmLabel, style: 'destructive', onPress: onConfirm },
    ],
    { cancelable: true },
  );
}
