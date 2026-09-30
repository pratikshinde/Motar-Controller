/**
 * Fault codes the panel can raise (SRS 6.2, firmware MotorProtection.h). For each one the locale files
 * hold three texts: its name (`faults.code<N>`), why it happens and what the farmer should do
 * (`faultInfo.code<N>.cause` / `.action`). `npm run i18n:check` fails when a language lacks any of them.
 */
export const FAULT_CODES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export const isKnownFault = (code: number | null | undefined): code is (typeof FAULT_CODES)[number] =>
  typeof code === 'number' && (FAULT_CODES as readonly number[]).includes(code);

export function faultInfoKeys(code: number | null | undefined): { cause: string; action: string } {
  const base = isKnownFault(code) ? `faultInfo.code${code}` : 'faultInfo.unknown';
  return { cause: `${base}.cause`, action: `${base}.action` };
}
