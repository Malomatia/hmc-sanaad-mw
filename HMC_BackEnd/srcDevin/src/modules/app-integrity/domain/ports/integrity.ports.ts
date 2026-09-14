import { AttestKey, IntegrityVerdict } from '../attestation';

/**
 * Server-issued nonces.
 *
 * A challenge must be OURS and usable ONCE — without both, an attacker replays
 * a captured attestation forever and the whole exercise is decorative. That is
 * the flaw in the reference sample this replaces, which returned a random
 * value and never stored it.
 */
export interface ChallengeStorePort {
  /** Issue and remember a nonce. */
  issue(username: string): Promise<string>;
  /**
   * Spend a nonce: true only if it was issued by us, has not expired, and has
   * not been used before. Consuming is part of checking, not a second step.
   */
  consume(value: string): Promise<boolean>;
}

export const CHALLENGE_STORE_PORT = Symbol('CHALLENGE_STORE_PORT');

/** Persistence for attested iOS keys — must survive a restart. */
export interface AttestKeyStorePort {
  save(key: AttestKey): Promise<void>;
  find(keyId: string): Promise<AttestKey | undefined>;
  /** Record the counter after a valid assertion, for replay detection. */
  updateSignCount(keyId: string, signCount: number): Promise<void>;
}

export const ATTEST_KEY_STORE_PORT = Symbol('ATTEST_KEY_STORE_PORT');

/** One-time registration of an iOS installation. */
export interface IosAttestationPort {
  readonly enabled: boolean;
  /**
   * Verify an attestation object and return the public key to store.
   * Verification is entirely local: the CBOR is parsed and its certificate
   * chain checked against Apple's App Attest root CA. Apple publishes no
   * endpoint for this, and a client cannot be trusted to do it.
   */
  verifyAttestation(input: {
    keyId: string;
    attestationBase64: string;
    challenge: string;
  }): Promise<{ ok: boolean; publicKey?: string; signCount?: number; reason?: string }>;

  /** Verify a per-request signature made with a previously attested key. */
  verifyAssertion(input: {
    assertionBase64: string;
    clientDataHash: Buffer;
    publicKey: string;
    previousSignCount: number;
  }): Promise<{ ok: boolean; signCount?: number; reason?: string }>;
}

export const IOS_ATTESTATION_PORT = Symbol('IOS_ATTESTATION_PORT');

/** Google Play Integrity token decoding and verdict evaluation. */
export interface AndroidIntegrityPort {
  readonly enabled: boolean;
  /**
   * `requestHash` is the SHA-256 the CLIENT computed over its own payload; it
   * is compared with the one inside the token. Without that comparison a valid
   * token can be lifted onto any other request, which is most of the value of
   * Play Integrity over a plain "is this app genuine" check.
   */
  verifyToken(token: string, requestHash?: string): Promise<IntegrityVerdict>;
}

export const ANDROID_INTEGRITY_PORT = Symbol('ANDROID_INTEGRITY_PORT');
