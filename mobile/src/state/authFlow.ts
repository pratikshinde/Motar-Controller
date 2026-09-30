import { create } from 'zustand';

/**
 * Transient, unpersisted state carried between the registration / forgot-password screens
 * (phone -> OTP -> create/reset password). Never written to storage: a killed app just
 * restarts the flow from the phone-number screen, which is fine since the OTP itself expires
 * in minutes anyway (see backend `OTP_TTL_MINUTES`).
 */
export type VerificationPurpose = 'registration' | 'password_reset';

interface AuthFlowState {
  phone: string;
  fullName: string;
  purpose: VerificationPurpose;
  verificationToken: string;
  devOtp: string | null;
  setPhone: (phone: string) => void;
  setFullName: (fullName: string) => void;
  startVerification: (purpose: VerificationPurpose, phone: string, devOtp: string | null) => void;
  setVerificationToken: (token: string) => void;
  reset: () => void;
}

export const useAuthFlow = create<AuthFlowState>((set) => ({
  phone: '',
  fullName: '',
  purpose: 'registration',
  verificationToken: '',
  devOtp: null,
  setPhone: (phone) => set({ phone }),
  setFullName: (fullName) => set({ fullName }),
  startVerification: (purpose, phone, devOtp) => set({ purpose, phone, devOtp, verificationToken: '' }),
  setVerificationToken: (verificationToken) => set({ verificationToken }),
  reset: () => set({ phone: '', fullName: '', purpose: 'registration', verificationToken: '', devOtp: null }),
}));
