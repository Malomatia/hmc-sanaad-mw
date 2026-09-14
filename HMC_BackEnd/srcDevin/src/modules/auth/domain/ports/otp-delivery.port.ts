import { Lang } from '@shared/domain/lang';
import { OtpPurpose } from './otp.port';

/**
 * Delivery half of the OTP flow (the storage half lives in OtpPort's adapter):
 * sends the raw OTP to the user's phone via the SMS gateway. The raw OTP goes
 * ONLY to this port — implementations must never log it, nor an unmasked
 * phone number.
 */
export interface OtpDeliveryPort {
  sendOtpSms(phoneNumber: string, otp: string, purpose: OtpPurpose, lang?: Lang): Promise<void>;
}

export const OTP_DELIVERY_PORT = Symbol('OTP_DELIVERY_PORT');
