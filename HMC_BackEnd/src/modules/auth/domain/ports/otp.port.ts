export type OtpPurpose = 'ONBOARDING' | 'FORGOT_MPIN';

/** Channel the OTP goes out on (mobile SMS vs. email). */
export type OtpMode = 'SMS' | 'Email';

export interface SendOtpCommand {
  username: string;
  phoneNumber?: string;
  /** Fallback channel: used when the user has no phone number but has email. */
  /** Email fallback channel when the employee has no registered phone. */
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
  /**
   * NEW = a fresh OTP was stored (inserted or overwrote the previous one);
   * PENDING = a still-valid, unused OTP already existed and was kept.
   */
  status: 'NEW' | 'PENDING';
  /** Channel used (or recorded) for this OTP. */
  mode: OtpMode;
  /**
   * How long this OTP remains valid, in seconds: the full TTL for a NEW one,
   * the remaining time for a PENDING one.
   */
  validForSeconds: number;
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
