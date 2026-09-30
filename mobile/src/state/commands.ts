import { create } from 'zustand';

export type CommandAction = 'START' | 'STOP';

/** What the farmer last asked a pump to do, kept while they move between screens. */
export interface CommandAttempt {
  pumpId: string;
  cid: string | null;
  action: CommandAction;
  idempotencyKey: string;
  sentAt: number;
  /** Set when the server refused or the network failed before we got a cid. */
  failed: boolean;
}

interface CommandState {
  attempts: Record<string, CommandAttempt | undefined>;
  cooldownUntil: Record<string, number | undefined>;
  setAttempt: (a: CommandAttempt) => void;
  patchAttempt: (pumpId: string, patch: Partial<CommandAttempt>) => void;
  clearAttempt: (pumpId: string) => void;
  startCooldown: (pumpId: string, seconds: number, now?: number) => void;
  clearCooldown: (pumpId: string) => void;
  reset: () => void;
}

export const useCommands = create<CommandState>((set) => ({
  attempts: {},
  cooldownUntil: {},
  setAttempt: (a) => set((s) => ({ attempts: { ...s.attempts, [a.pumpId]: a } })),
  patchAttempt: (pumpId, patch) =>
    set((s) =>
      s.attempts[pumpId] ? { attempts: { ...s.attempts, [pumpId]: { ...s.attempts[pumpId]!, ...patch } } } : s,
    ),
  clearAttempt: (pumpId) => set((s) => ({ attempts: { ...s.attempts, [pumpId]: undefined } })),
  startCooldown: (pumpId, seconds, now = Date.now()) =>
    set((s) => ({ cooldownUntil: { ...s.cooldownUntil, [pumpId]: now + seconds * 1000 } })),
  clearCooldown: (pumpId) => set((s) => ({ cooldownUntil: { ...s.cooldownUntil, [pumpId]: undefined } })),
  reset: () => set({ attempts: {}, cooldownUntil: {} }),
}));

export const cooldownSecondsLeft = (until: number | undefined, now: number = Date.now()): number =>
  until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
