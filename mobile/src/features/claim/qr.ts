/**
 * The QR code a dealer hands a farmer (printed from the website's "Add farmer" form). It holds a one-time secret behind this prefix.
 * The app only checks that a scanned code looks like one of ours; the server decides whether it is still valid.
 */
export const CLAIM_PREFIX = 'AGP-CLAIM:';

export function isClaimQr(text: string | null | undefined): boolean {
  const value = (text ?? '').trim();
  if (!value.startsWith(CLAIM_PREFIX)) return false;
  const secret = value.slice(CLAIM_PREFIX.length).trim();
  return secret.length >= 20 && secret.length <= 128;
}
