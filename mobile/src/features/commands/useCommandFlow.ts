import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { newRequestId } from '@/api/session';
import {
  getGetPumpCommandQueryKey,
  getGetPumpQueryKey,
  getListPumpsQueryKey,
  sendPumpCommand,
  useGetPumpCommand,
} from '@/api/generated/farmer';
import type { PumpResponse } from '@/api/generated/model';
import { CommandAction, cooldownSecondsLeft, useCommands } from '@/state/commands';
import { cooldownSecondsFrom } from '@/shared/i18n/errors';
import { useNow } from '@/shared/hooks/useOnline';
import { commandProgress, isFinished, Progress } from './progress';

/** The server's own pause between two commands to one pump (command_service.COMMAND_COOLDOWN_SECONDS). */
const DEFAULT_COOLDOWN_S = 45;

const ms = (iso: string | null | undefined): number | null => {
  const n = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(n) ? null : n;
};

export interface CommandFlow {
  attempt: ReturnType<typeof useCommands.getState>['attempts'][string];
  progress: Progress | null;
  cooldownLeft: number;
  sending: boolean;
  error: unknown;
  start: (action: CommandAction) => Promise<void>;
  /** Re-sends the SAME request (same Idempotency-Key) after a network failure, so it cannot run twice. */
  retry: () => Promise<void>;
  dismiss: () => void;
}

export function useCommandFlow(pump: Pick<PumpResponse, 'id' | 'pump_on' | 'last_seen_at'>): CommandFlow {
  const qc = useQueryClient();
  const attempt = useCommands((s) => s.attempts[pump.id]);
  const cooldownUntil = useCommands((s) => s.cooldownUntil[pump.id]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const active = !!attempt && !attempt.failed;
  const now = useNow(active || !!cooldownUntil ? 1000 : 60_000);

  const cmd = useGetPumpCommand(pump.id, attempt?.cid ?? '', {
    query: { enabled: !!attempt?.cid, refetchInterval: 3000 },
  });

  const progress = useMemo<Progress | null>(() => {
    if (!attempt || attempt.failed || !attempt.cid) return null;
    return commandProgress({
      status: cmd.data?.status ?? 'QUEUED',
      deliveredAt: cmd.data?.delivered_at,
      ackedAt: cmd.data?.acked_at,
      rejectReason: cmd.data?.reject_reason,
      issuedAtMs: ms(cmd.data?.issued_at) ?? attempt.sentAt,
      waitedMs: now - attempt.sentAt,
      expectedPumpOn: attempt.action === 'START',
      pumpOn: pump.pump_on,
      lastReadingAtMs: ms(pump.last_seen_at),
    });
  }, [attempt, cmd.data, now, pump.pump_on, pump.last_seen_at]);

  // The pump's own data refreshes slowly and the live push may not reach this phone, so the screen would show
  // "done" next to the old state. Re-read the pump with every command poll, and again shortly after the end
  // (the pump's next reading can land a few seconds after the command is confirmed).
  const cid = attempt?.cid;
  const ended = !!progress && (isFinished(progress) || progress.kind === 'notConfirmed');
  const refreshPump = useCallback(() => {
    void qc.invalidateQueries({ queryKey: getGetPumpQueryKey(pump.id) });
    void qc.invalidateQueries({ queryKey: getListPumpsQueryKey() });
  }, [qc, pump.id]);
  useEffect(() => {
    if (cid && !ended) refreshPump();
  }, [cid, ended, cmd.dataUpdatedAt, refreshPump]);
  useEffect(() => {
    if (!cid || !ended) return undefined;
    refreshPump();
    const timers = [3000, 8000].map((delay) => setTimeout(refreshPump, delay));
    return () => timers.forEach(clearTimeout);
  }, [cid, ended, refreshPump]);

  // A command that never left the server cannot have cycled the motor, and the server no longer makes them wait.
  const notSent = progress?.kind === 'notSent';
  useEffect(() => {
    if (notSent) useCommands.getState().clearCooldown(pump.id);
  }, [notSent, pump.id]);

  const send = useCallback(
    async (action: CommandAction, key: string) => {
      const store = useCommands.getState();
      setSending(true);
      setError(null);
      try {
        const res = await sendPumpCommand(
          pump.id,
          { command: action, action },
          { headers: { 'Idempotency-Key': key } },
        );
        const cid = res.command.cid;
        store.setAttempt({ pumpId: pump.id, cid, action, idempotencyKey: key, sentAt: Date.now(), failed: false });
        store.startCooldown(pump.id, DEFAULT_COOLDOWN_S);
        void qc.invalidateQueries({ queryKey: getGetPumpCommandQueryKey(pump.id, cid) });
      } catch (err) {
        const wait = cooldownSecondsFrom(err);
        if (wait) store.startCooldown(pump.id, wait);
        // No answer at all: keep the key so "try again" is the same request, not a second command.
        const noAnswer = !(err as { response?: unknown })?.response;
        if (noAnswer)
          store.setAttempt({
            pumpId: pump.id,
            cid: null,
            action,
            idempotencyKey: key,
            sentAt: Date.now(),
            failed: true,
          });
        else store.clearAttempt(pump.id);
        setError(err);
      } finally {
        setSending(false);
      }
    },
    [pump.id, qc],
  );

  const start = useCallback((action: CommandAction) => send(action, newRequestId()), [send]);

  const retry = useCallback(async () => {
    const a = useCommands.getState().attempts[pump.id];
    if (a) await send(a.action, a.idempotencyKey);
  }, [pump.id, send]);

  const dismiss = useCallback(() => {
    useCommands.getState().clearAttempt(pump.id);
    setError(null);
    void qc.invalidateQueries({ queryKey: getGetPumpQueryKey(pump.id) });
  }, [pump.id, qc]);

  return {
    attempt,
    progress,
    cooldownLeft: cooldownSecondsLeft(cooldownUntil, now),
    sending,
    error,
    start,
    retry,
    dismiss,
  };
}
