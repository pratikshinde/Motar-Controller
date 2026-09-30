import { apiJson } from './client';
import type { CommandRecord } from '../types';

type Terminal = 'APPLIED' | 'REJECTED' | 'EXPIRED' | 'FAILED' | 'NOT_CONFIRMED';
const TERMINAL: Terminal[] = ['APPLIED', 'REJECTED', 'EXPIRED', 'FAILED', 'NOT_CONFIRMED'];

export const isTerminal = (status: string): boolean => (TERMINAL as string[]).includes(status);

/**
 * Follows one command until the server calls it finished (or ~90 s pass). The server moves a command on evidence
 * only: SENT means the network took it, APPLIED means the pump's own reading (or its acknowledgement) proved it.
 * Returns a function that stops watching.
 */
export function watchCommand(
  pumpId: string,
  cid: string,
  onUpdate: (command: CommandRecord) => void,
  { intervalMs = 2000, timeoutMs = 90000 } = {}
): () => void {
  let stopped = false;
  const started = Date.now();
  let last = '';

  async function tick() {
    if (stopped) return;
    try {
      const cmd = await apiJson<CommandRecord>(`/pumps/${encodeURIComponent(pumpId)}/commands/${encodeURIComponent(cid)}`);
      if (cmd.status !== last) {
        last = cmd.status;
        onUpdate(cmd);
      }
      if (isTerminal(cmd.status)) return;
    } catch {
      // A missed poll is not a verdict; the next one (or the timeout) decides.
    }
    if (Date.now() - started < timeoutMs) setTimeout(tick, intervalMs);
  }

  setTimeout(tick, 800);
  return () => {
    stopped = true;
  };
}

/** What to tell the operator for a command's status, or null while it is still in flight. */
export function outcomeOf(cmd: Pick<CommandRecord, 'status' | 'reject_reason' | 'failure_reason'>, action: string):
  { text: string; error: boolean } | null {
  switch (cmd.status) {
    case 'APPLIED':
      return { text: `${action} confirmed: the pump reports it has done it`, error: false };
    case 'NOT_CONFIRMED':
      return { text: `${action} not confirmed: the pump has not answered. Check the pump before trying again`, error: true };
    case 'FAILED':
      return { text: `${action} was not sent (${cmd.failure_reason || 'no channel to the pump'}): the pump was not asked`, error: true };
    case 'REJECTED':
      return { text: `${action} refused by the pump${cmd.reject_reason ? `: ${cmd.reject_reason}` : ''}`, error: true };
    case 'EXPIRED':
      return { text: `${action} expired before it reached the pump`, error: true };
    default:
      return null;
  }
}
