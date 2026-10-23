import { apiJson } from './client';

export type VerificationPurpose = 'registration' | 'password_reset';

export interface SendCodeResult {
  message: string;
  phone_number: string;
  channel: string;
  /** Present only when the server runs in development mode; never in production. */
  dev_otp?: string;
}

/** The phone number the way the server keys its codes and tickets on it: no spaces, no dashes. */
export function normalizePhone(phone: string): string {
  return phone.trim().replace(/[\s-]/g, '');
}

/** True when the text could be a mobile number (10 to 15 digits, optional leading +). */
export function looksLikePhone(phone: string): boolean {
  return /^\+?\d{10,15}$/.test(normalizePhone(phone));
}

/** Set a new password after the phone was proven (purpose "password_reset"). Ends every session of that account. */
export async function resetPassword(phone: string, ticket: string, newPassword: string): Promise<{ message: string }> {
  return apiJson('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ phone_number: normalizePhone(phone), verification_token: ticket, new_password: newPassword })
  });
}

/** Send a one-time code to the number on WhatsApp. */
export async function sendPhoneCode(phone: string, purpose: VerificationPurpose = 'registration'): Promise<SendCodeResult> {
  return apiJson('/auth/verify-phone/send', {
    method: 'POST',
    body: JSON.stringify({ phone_number: normalizePhone(phone), purpose })
  });
}

/**
 * Check the code the person read off WhatsApp. Returns a single-use ticket for exactly this number and purpose; the call
 * that creates the account (or resets the password) spends it, so "proved the phone" and "used that proof" stay two steps.
 */
export async function confirmPhoneCode(phone: string, code: string, purpose: VerificationPurpose = 'registration'): Promise<string> {
  const body = await apiJson<{ verification_token: string }>('/auth/verify-phone/confirm', {
    method: 'POST',
    body: JSON.stringify({ phone_number: normalizePhone(phone), purpose, code: code.trim() })
  });
  return body.verification_token;
}
