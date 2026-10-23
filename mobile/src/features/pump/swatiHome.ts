import type { PumpState } from '@/features/pumps/model';

/** Fault code the Fuji drive raises when the DC (solar) voltage is too low to run the motor (backend phase6_solar_vfd). */
export const VFD_DC_UNDER_VOLT = 101;

/** The drive's own status word -> the translation key of its plain-language name, or null for a word we do not know. */
export function driveStatusKey(status: string | null | undefined): string | null {
  switch ((status ?? '').trim().toUpperCase()) {
    case 'RUNNING':
    case 'RUN':
      return 'pumps.status.running';
    case 'STOPPED':
    case 'STOP':
      return 'pumps.status.stopped';
    case 'FAULT':
    case 'ALARM':
      return 'pumps.status.fault';
    default:
      return null;
  }
}

export type HeroKind =
  | 'running'
  | 'stopped'
  | 'starting'
  | 'stopping'
  | 'offline'
  | 'nodata'
  | 'sunlight'
  | 'problem';

export interface HeroInput {
  state: PumpState;
  /** The command the farmer sent that is still being carried out, if any. */
  pending: 'START' | 'STOP' | null;
  isSolar: boolean;
  faultCode: number | null | undefined;
}

/**
 * Which of the home screen's states to show. Only what the server actually reported decides it: a pump that went quiet is
 * "offline", never "stopped"; a solar pump whose drive reports too little DC voltage is simply waiting for the sun, which
 * is normal at dawn, dusk and under cloud and must not look like a breakdown.
 */
export function heroKind({ state, pending, isSolar, faultCode }: HeroInput): HeroKind {
  if (pending === 'START') return 'starting';
  if (pending === 'STOP') return 'stopping';
  if (state === 'offline') return 'offline';
  if (state === 'nodata') return 'nodata';
  if (state === 'fault') return isSolar && faultCode === VFD_DC_UNDER_VOLT ? 'sunlight' : 'problem';
  return state;
}
