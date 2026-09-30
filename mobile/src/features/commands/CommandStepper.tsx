import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Circle, XCircle } from 'lucide-react-native';
import { colors, font, space } from '@/shared/theme';
import { Card, CardTitle } from '@/shared/ui/Card';
import { BigActionButton } from '@/shared/ui/BigActionButton';
import type { CommandAction } from '@/state/commands';
import { Progress, STEPS } from './progress';

const AUTO_DISMISS_MS = 6000;

/**
 * Shows exactly how far a start / stop request has got: Sent, Reached the pump, Pump confirmed, Done.
 * A step is only ticked when something really happened. If the pump does not answer in time the
 * card says "not confirmed yet" (it may still arrive) rather than claiming failure or success.
 */
export const CommandStepper: React.FC<{
  action: CommandAction;
  progress: Progress | null;
  /** Network failed before the server answered: the request may or may not have been received. */
  sendFailed?: boolean;
  onRetry?: () => void;
  onDismiss: () => void;
}> = ({ action, progress, sendFailed, onRetry, onDismiss }) => {
  const { t } = useTranslation();

  useEffect(() => {
    if (progress?.kind !== 'done') return undefined;
    const id = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [progress?.kind, onDismiss]);

  const reached = !progress
    ? 0
    : progress.kind === 'done'
      ? STEPS.length - 1
      : 'reached' in progress
        ? progress.reached
        : 0;
  const finished = progress?.kind === 'done';
  const stalled = progress?.kind === 'notConfirmed';

  return (
    <Card>
      <CardTitle title={t(action === 'START' ? 'command.titleStart' : 'command.titleStop')} />
      {sendFailed ? (
        <View style={styles.note}>
          <AlertTriangle size={20} color={colors.warn} />
          <Text style={[styles.noteText, { color: colors.warn }]}>{t('errors.network')}</Text>
        </View>
      ) : (
        <View accessibilityRole="progressbar" style={styles.steps}>
          {STEPS.map((key, i) => {
            const done = finished || i <= reached;
            const waiting = !done && i === reached + 1 && !stalled && progress?.kind === 'inProgress';
            const stuck = !done && i === reached + 1 && stalled;
            return (
              <View
                key={key}
                style={styles.step}
                accessible
                accessibilityLabel={`${t(`command.step.${key}`)}${done ? ` ✓` : ''}`}
              >
                <View style={styles.icon}>
                  {done ? (
                    <Check size={20} color={colors.ok} />
                  ) : waiting ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : stuck ? (
                    <AlertTriangle size={18} color={colors.warn} />
                  ) : (
                    <Circle size={18} color={colors.borderStrong} />
                  )}
                </View>
                <Text style={[styles.label, done && styles.labelDone, stuck && { color: colors.warn }]}>
                  {t(`command.step.${key}`)}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {progress?.kind === 'notConfirmed' ? (
        <Text style={[styles.message, { color: colors.warn }]}>{t('command.notConfirmed')}</Text>
      ) : null}
      {progress?.kind === 'rejected' ? (
        <View style={styles.note}>
          <XCircle size={20} color={colors.danger} />
          <Text style={[styles.noteText, { color: colors.danger }]}>
            {progress.reason ? t('command.rejectedWhy', { reason: progress.reason }) : t('command.rejected')}
          </Text>
        </View>
      ) : null}
      {progress?.kind === 'expired' ? (
        <Text style={[styles.message, { color: colors.danger }]}>{t('command.expired')}</Text>
      ) : null}
      {progress?.kind === 'notSent' ? (
        <Text style={[styles.message, { color: colors.danger }]}>{t('command.notSent')}</Text>
      ) : null}
      {finished ? <Text style={[styles.message, { color: colors.ok }]}>{t('command.done')}</Text> : null}

      <View style={styles.actions}>
        {sendFailed && onRetry ? <BigActionButton label={t('command.tryAgain')} onPress={onRetry} /> : null}
        {progress && progress.kind !== 'inProgress' && !finished ? (
          <BigActionButton label={t('command.dismiss')} onPress={onDismiss} tone="neutral" />
        ) : null}
        {sendFailed ? <BigActionButton label={t('command.dismiss')} onPress={onDismiss} tone="neutral" /> : null}
      </View>
    </Card>
  );
};

const styles = StyleSheet.create({
  steps: { gap: 10 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 26, alignItems: 'center' },
  label: { color: colors.textMuted, fontSize: font.body, fontWeight: '700', flexShrink: 1 },
  labelDone: { color: colors.text },
  message: { marginTop: space.md, fontSize: font.body, fontWeight: '700', lineHeight: 23 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  noteText: { flex: 1, fontSize: font.body, fontWeight: '700', lineHeight: 23 },
  actions: { gap: 10, marginTop: space.md },
});
