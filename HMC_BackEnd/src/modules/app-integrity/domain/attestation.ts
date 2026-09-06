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
