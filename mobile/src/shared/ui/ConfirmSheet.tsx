import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, space } from '../theme';
import { ActionTone, BigActionButton } from './BigActionButton';

/**
 * Bottom sheet that asks before anything that changes a pump. The caller puts the pump's name in
 * `title`/`message` so a farmer with several pumps always sees WHICH one they are about to act on.
 */
export const ConfirmSheet: React.FC<{
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  tone?: ActionTone;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ visible, title, message, confirmLabel, cancelLabel, tone = 'primary', busy, onConfirm, onCancel }) => (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
    <View style={styles.overlay}>
      <Pressable
        style={styles.backdrop}
        onPress={onCancel}
        accessibilityLabel={cancelLabel}
        accessibilityRole="button"
      />
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.grabber} />
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        <View style={styles.actions}>
          <BigActionButton label={confirmLabel} onPress={onConfirm} tone={tone} loading={busy} testID="confirm-yes" />
          <BigActionButton label={cancelLabel} onPress={onCancel} tone="neutral" disabled={busy} testID="confirm-no" />
        </View>
      </View>
    </View>
  </Modal>
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
  grabber: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.borderStrong,
    marginBottom: 4,
  },
  title: { color: colors.text, fontSize: font.headline, fontWeight: '900', textAlign: 'center' },
  message: { color: colors.textMuted, fontSize: font.bodyLg, textAlign: 'center', lineHeight: 26 },
  actions: { gap: 10, marginTop: 8 },
});
