import { http } from '@/api/http';
import type { VerificationPurpose } from '@/state/authFlow';

interface SendResponse {
  message: string;
  phone_number: string;
  channel: string;
  /** Only present when the backend runs with ENV=development. */
  dev_otp?: string;
}

interface ConfirmResponse {
  verification_token: string;
}

export async function sendPhoneVerification(phone: string, purpose: VerificationPurpose): Promise<SendResponse> {
  const { data } = await http.post<SendResponse>('/auth/verify-phone/send', { phone_number: phone, purpose });
  return data;
}

export async function confirmPhoneVerification(
  phone: string,
  purpose: VerificationPurpose,
  code: string,
): Promise<ConfirmResponse> {
  const { data } = await http.post<ConfirmResponse>('/auth/verify-phone/confirm', {
    phone_number: phone,
    purpose,
    code,
  });
  return data;
}
