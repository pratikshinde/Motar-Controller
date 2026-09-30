import { COMMAND_CONFIRM_MS } from '@/config/env';

/** The four steps a farmer sees: Sent, Delivered, Acknowledged, Applied. */
export const STEPS = ['sent', 'delivered', 'acknowledged', 'applied'] as const;
export type StepKey = (typeof STEPS)[number];

export type Progress =
  /** `reached` = index in STEPS of the last step that really happened. */
  | { kind: 'inProgress'; reached: number }
  /** The pump has not answered in time. Interim: it may still arrive, and it is not "failed". */
  | { kind: 'notConfirmed'; reached: number }
  | { kind: 'done' }
  | { kind: 'rejected'; reason: string | null }
  | { kind: 'expired' }
  /** The server could not hand the command to the network: the pump was never asked, so it is safe to try again. */
  | { kind: 'notSent' };

export interface ProgressInput {
  /**
   * Server-side command status: QUEUED, SENT, DELIVERED, ACKNOWLEDGED, APPLIED, or the endings
   * REJECTED, EXPIRED, FAILED, NOT_CONFIRMED.
   */
  status?: string | null;
  deliveredAt?: string | null;
  ackedAt?: string | null;
  rejectReason?: string | null;
  /** When the server accepted the command (server clock: only ever compared with the pump's own reading times). */
  issuedAtMs: number;
  /** How long this phone has been waiting (phone clock minus phone clock, so clock skew cannot matter). */
  waitedMs: number;
  /** START = true, STOP = false. */
  expectedPumpOn: boolean;
  /** Latest reading the pump sent, and when. */
  pumpOn?: boolean | null;
  lastReadingAtMs?: number | null;
  confirmMs?: number;
}

const REJECTED = new Set(['REJECTED', 'NACK', 'ERROR']);
const EXPIRED = new Set(['EXPIRED', 'TIMEOUT', 'TIMED_OUT']);
const NOT_SENT = new Set(['FAILED']);
const NOT_CONFIRMED = new Set(['NOT_CONFIRMED']);
// SENT means the server handed it to the network, which says nothing about the pump: it is not "reached the pump".
const DELIVERED = new Set(['DELIVERED']);
const ACKED = new Set(['ACKED', 'ACKNOWLEDGED', 'ACK', 'OK', 'EXECUTED']);
const APPLIED = new Set(['APPLIED', 'COMPLETED', 'DONE']);

/** A reading after the command shows the pump in the requested state: that is the proof it worked. */
const TOLERANCE_MS = 2_000;

export function commandProgress(i: ProgressInput): Progress {
  const status = (i.status ?? '').toUpperCase();
  if (REJECTED.has(status)) return { kind: 'rejected', reason: i.rejectReason ?? null };
  if (EXPIRED.has(status)) return { kind: 'expired' };
  if (NOT_SENT.has(status)) return { kind: 'notSent' };

  const observed =
    i.pumpOn === i.expectedPumpOn &&
    typeof i.lastReadingAtMs === 'number' &&
    i.lastReadingAtMs >= i.issuedAtMs - TOLERANCE_MS;
  if (APPLIED.has(status) || observed) return { kind: 'done' };

  let reached = 0;
  if (DELIVERED.has(status) || i.deliveredAt) reached = 1;
  if (ACKED.has(status) || i.ackedAt) reached = 2;

  // The server has given up waiting for proof (the pump's reading never showed the change): believe it at once.
  if (NOT_CONFIRMED.has(status)) return { kind: 'notConfirmed', reached };
  if (reached < 2 && i.waitedMs > (i.confirmMs ?? COMMAND_CONFIRM_MS)) return { kind: 'notConfirmed', reached };
  return { kind: 'inProgress', reached };
}

export const isFinished = (p: Progress): boolean =>
  p.kind === 'done' || p.kind === 'rejected' || p.kind === 'expired' || p.kind === 'notSent';
