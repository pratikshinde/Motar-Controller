import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Timer as TimerIcon } from 'lucide-react-native';
import { getGetPumpTimerQueryKey, setPumpTimer, useGetPumpTimer } from '@/api/generated/farmer';
import type { PumpResponse } from '@/api/generated/model';
import { newRequestId } from '@/api/session';
import { colors, font } from '@/shared/theme';
import { Banner } from '@/shared/ui/Banner';
import { BigActionButton } from '@/shared/ui/BigActionButton';
import { Card, CardTitle } from '@/shared/ui/Card';
import { ConfirmSheet } from '@/shared/ui/ConfirmSheet';
import { NumberField } from '@/shared/ui/NumberField';
import { friendlyError, cooldownSecondsFrom } from '@/shared/i18n/errors';
import { useNow, useOnline } from '@/shared/hooks/useOnline';
import { canControl, displayName } from '@/features/pumps/model';
import { cooldownSecondsLeft, useCommands } from '@/state/commands';
import { TIMER_LIMITS, TimerForm, TimerValue, clampTo, parseTimer, timerToRequest } from './validation';

type Field = keyof TimerForm;

const summaryKey = (v: TimerValue): { key: string; params: Record<string, number> } => {
  if (v.off === 0 || v.cycles === 1) return { key: 'timer.summaryOnce', params: { on: v.on } };
  if (v.cycles === 0) return { key: 'timer.summaryForever', params: { on: v.on, off: v.off } };
  return { key: 'timer.summaryRepeat', params: { on: v.on, off: v.off, cycles: v.cycles } };
};

/** Send a run timer to the pump: run X minutes, rest Y minutes, repeat Z times. */
export const TimerTab: React.FC<{ pump: PumpResponse }> = ({ pump }) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const online = useOnline();
  const now = useNow(1000);
  const q = useGetPumpTimer(pump.id);
  const cooldownUntil = useCommands((s) => s.cooldownUntil[pump.id]);

  const sent = q.data?.timer;
  const last = sent
    ? { on: sent.on_duration_minutes, off: sent.off_duration_minutes ?? 0, cycles: sent.cycle_count ?? 1 }
    : null;
  const [form, setForm] = useState<TimerForm>({ on: '30', off: '0', cycles: '1' });
  const seeded = useRef(false);
  // Fill the form from the last timer that was sent, once, without overwriting what the farmer types.
  if (last && !seeded.current) {
    seeded.current = true;
    setForm({ on: String(last.on), off: String(last.off), cycles: String(last.cycles) });
  }

  const [errors, setErrors] = useState<Partial<Record<Field, true>>>({});
  const [pending, setPending] = useState<TimerValue | null>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);

  const name = displayName(pump);
  const cooldownLeft = cooldownSecondsLeft(cooldownUntil, now);
  const blocked = !canControl(pump) || !online;

  const set = (f: Field, v: string) => {
    setForm((s) => ({ ...s, [f]: v }));
    setErrors((e) => ({ ...e, [f]: undefined }));
    setSentAt(null);
  };
  const step = (f: Field, delta: number) => {
    const lim = f === 'on' ? TIMER_LIMITS.on : f === 'off' ? TIMER_LIMITS.off : TIMER_LIMITS.cycles;
    const cur = Number(form[f]);
    set(f, String(clampTo((Number.isFinite(cur) ? cur : lim.min) + delta, lim)));
  };

  const review = () => {
    const parsed = parseTimer(form);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setFailure(null);
    setPending(parsed.value);
  };

  const idempotencyKey = useRef<string | null>(null);
  const send = async () => {
    const value = pending;
    if (!value) return;
    idempotencyKey.current = idempotencyKey.current ?? newRequestId();
    setSending(true);
    try {
      await setPumpTimer(pump.id, timerToRequest(value), { headers: { 'Idempotency-Key': idempotencyKey.current } });
      idempotencyKey.current = null;
      useCommands.getState().startCooldown(pump.id, 45);
      setSentAt(Date.now());
      setPending(null);
      void qc.invalidateQueries({ queryKey: getGetPumpTimerQueryKey(pump.id) });
    } catch (err) {
      const wait = cooldownSecondsFrom(err);
      if (wait) useCommands.getState().startCooldown(pump.id, wait);
      if ((err as { response?: unknown })?.response) idempotencyKey.current = null; // the server answered: a new attempt is a new request
      setFailure(err);
      setPending(null);
    } finally {
      setSending(false);
    }
  };

  const summary = useMemo(() => {
    const p = parseTimer(form);
    return p.ok ? summaryKey(p.value) : null;
  }, [form]);

  return (
    <View style={styles.stack}>
      {!canControl(pump) ? <Banner tone="danger" text={t('timer.remoteBlocked')} /> : null}
      {!online ? <Banner tone="warn" text={t('command.offlineBlock')} /> : null}

      <Card>
        <CardTitle icon={TimerIcon} title={t('timer.title')} />
        <Text style={styles.intro}>{t('timer.intro')}</Text>
        <View style={styles.fields}>
          <NumberField
            testID="timer-on"
            label={t('timer.onLabel')}
            hint={t('timer.range', TIMER_LIMITS.on)}
            value={form.on}
            onChange={(v) => set('on', v)}
            onStep={(d) => step('on', d)}
            error={errors.on ? t('timer.errorOn') : undefined}
            lessLabel={t('common.less')}
            moreLabel={t('common.more')}
          />
          <NumberField
            testID="timer-off"
            label={t('timer.offLabel')}
            hint={t('timer.range', TIMER_LIMITS.off)}
            value={form.off}
            onChange={(v) => set('off', v)}
            onStep={(d) => step('off', d)}
            error={errors.off ? t('timer.errorOff') : undefined}
            lessLabel={t('common.less')}
            moreLabel={t('common.more')}
          />
          <NumberField
            testID="timer-cycles"
            label={t('timer.cyclesLabel')}
            hint={`${t('timer.range', TIMER_LIMITS.cycles)} · ${t('timer.cyclesHint')}`}
            value={form.cycles}
            onChange={(v) => set('cycles', v)}
            onStep={(d) => step('cycles', d)}
            error={errors.cycles ? t('timer.errorCycles') : undefined}
            lessLabel={t('common.less')}
            moreLabel={t('common.more')}
          />
        </View>
        {summary ? <Text style={styles.summary}>{t(summary.key, summary.params)}</Text> : null}
        {failure ? <Banner tone="danger" text={friendlyError(failure, t, 'command')} testID="timer-error" /> : null}
        {sentAt ? <Banner tone="info" text={t('timer.sentUnconfirmed')} testID="timer-sent" /> : null}
        <View style={styles.action}>
          <BigActionButton
            testID="timer-save"
            label={cooldownLeft > 0 ? t('command.cooldown', { seconds: cooldownLeft }) : t('timer.save')}
            onPress={review}
            disabled={blocked || cooldownLeft > 0}
          />
        </View>
      </Card>

      <Card>
        <CardTitle title={t('timer.current')} />
        {last ? (
          <Text style={styles.summary}>{t(summaryKey(last).key, summaryKey(last).params)}</Text>
        ) : (
          <Text style={styles.intro}>{t('timer.none')}</Text>
        )}
      </Card>

      <ConfirmSheet
        visible={pending !== null}
        title={t('timer.confirmTitle', { name })}
        message={pending ? t(summaryKey(pending).key, summaryKey(pending).params) : undefined}
        confirmLabel={t('timer.confirmYes')}
        cancelLabel={t('dashboard.no')}
        busy={sending}
        onConfirm={send}
        onCancel={() => setPending(null)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  stack: { gap: 16 },
  intro: { color: colors.textMuted, fontSize: font.body, lineHeight: 23, marginBottom: 12 },
  fields: { gap: 18 },
  summary: { color: colors.text, fontSize: font.bodyLg, fontWeight: '800', lineHeight: 26, marginTop: 16 },
  action: { marginTop: 16 },
});
