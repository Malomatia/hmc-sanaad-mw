import { OtpPurpose } from './otp.port';

/**
 * Email twin of OtpDeliveryPort: delivers the raw OTP to the user's corporate
 * email — the fallback channel when the directory has NO mobile number for
 * the user. The raw OTP goes ONLY to this port — implementations must never
 * log it, nor an unmasked email address.
 */
export interface OtpEmailDeliveryPort {
  sendOtpEmail(email: string, otp: string, purpose: OtpPurpose): Promise<void>;
}

export const OTP_EMAIL_DELIVERY_PORT = Symbol('OTP_EMAIL_DELIVERY_PORT');
