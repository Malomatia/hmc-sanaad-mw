export type OtpPurpose = 'ONBOARDING' | 'FORGOT_MPIN';

export interface SendOtpCommand {
  username: string;
  phoneNumber?: string;
  /** Fallback channel: used when the user has no phone number but has email. */
  email?: string;
  imei: string;
  purpose: OtpPurpose;
  /** Client app context mirrored into the legacy OTP row (nothing NULL). */
  appName?: string;
  appVersion?: string;
  /** Client-reported datetime (the request's `sysdate`). */
  appDatetime?: string;
}

export interface SendOtpResult {
  /** Correlation id echoed back by the client on OTP verification. */
  requestId: string;
}

export interface VerifyOtpCommand {
  username: string;
  imei: string;
  requestId: string;
  otp: string;
}

/**
 * Port for OTP delivery + verification (APIs 2/3/6/7). Backed by the SMS/OTP
 * provider and an OTP store keyed by requestId. Spec/creds pending.
 */
export interface OtpPort {
  send(cmd: SendOtpCommand): Promise<SendOtpResult>;
  verify(cmd: VerifyOtpCommand): Promise<boolean>;
}

export const OTP_PORT = Symbol('OTP_PORT');
