/** The two attestation technologies, judged independently. */
export type IntegrityPlatform = 'ios' | 'android';

/**
 * A registered App Attest key.
 *
 * iOS attests ONCE per installation and then signs each later request with the
 * same Secure Enclave key, so the public key has to outlive the process — lose
 * it and every iOS user has to attest again.
 */
export interface AttestKey {
  keyId: string;
  username: string;
  /** Base64 of the P-256 public key extracted from the attestation. */
  publicKey: string;
  /**
   * Last signature counter seen. App Attest increments it on every assertion,
   * so a counter that does not advance is a replay.
   */
  signCount: number;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Owner recorded for a key attested BEFORE login.
 *
 * iOS attests as soon as the app starts, and there is no session yet — so the
 * key is stored against the device that presented the challenge, and the first
 * authenticated assertion claims it for that user. `LoginID` is NOT NULL and
 * the client declined a device column, so the device is written into the same
 * column behind a prefix no login can carry (`:` is not legal in an AD name,
 * and employee numbers are digits). The column is NVARCHAR(100); a device id
 * may itself be 100 characters, so the value is cut to fit — it is never
 * looked up by, only recognised.
 */
export const UNBOUND_KEY_OWNER_PREFIX = 'device:';

export const unboundKeyOwner = (deviceId: string): string =>
  `${UNBOUND_KEY_OWNER_PREFIX}${deviceId}`.slice(0, 100);

export const isUnboundKeyOwner = (owner: string): boolean =>
  owner.startsWith(UNBOUND_KEY_OWNER_PREFIX);

/** A server-issued nonce, so a client cannot attest against its own value. */
export interface Challenge {
  value: string;
  expiresAt: Date;
}

/** Outcome of verifying one request, whichever platform produced it. */
export interface IntegrityVerdict {
  ok: boolean;
  platform: IntegrityPlatform;
  /** Populated when `ok` is false — logged, never returned to the client. */
  reason?: string;
  /** Google's raw verdicts, for the observe-mode logs. */
  details?: Record<string, unknown>;
}
