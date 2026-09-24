import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { IntegrityVerdict, isUnboundKeyOwner, unboundKeyOwner } from '../domain/attestation';
import {
  ANDROID_INTEGRITY_PORT,
  ATTEST_KEY_STORE_PORT,
  AndroidIntegrityPort,
  AttestKeyStorePort,
  CHALLENGE_STORE_PORT,
  ChallengeStorePort,
  IOS_ATTESTATION_PORT,
  IosAttestationPort,
} from '../domain/ports/integrity.ports';

/**
 * Device attestation for both platforms.
 *
 * They work differently and that difference is the whole design:
 *
 *  - **iOS** registers ONCE (`attest`) and then signs each request with the
 *    stored key (`assert`), so the server issues a nonce and keeps a public
 *    key per installation;
 *  - **Android** has no registration. Each call carries a fresh token that
 *    already contains a hash of the request body, so nothing is stored.
 *
 * Verifying never throws: the guard above decides what a failure means
 * according to the configured mode, and a verification that cannot run is
 * reported as a refusal with a reason, not an exception.
 */
@Injectable()
export class AppIntegrityService {
  constructor(
    @Inject(CHALLENGE_STORE_PORT) private readonly challenges: ChallengeStorePort,
    @Inject(ATTEST_KEY_STORE_PORT) private readonly keys: AttestKeyStorePort,
    @Inject(IOS_ATTESTATION_PORT) private readonly ios: IosAttestationPort,
    @Inject(ANDROID_INTEGRITY_PORT) private readonly android: AndroidIntegrityPort,
  ) {}

  get iosEnabled(): boolean {
    return this.ios.enabled;
  }

  get androidEnabled(): boolean {
    return this.android.enabled;
  }

  /** A one-time nonce for the client to attest or assert against. */
  issueChallenge(deviceId: string): Promise<string> {
    return this.challenges.issue(deviceId);
  }

  /**
   * iOS registration — verify the attestation and remember the public key.
   *
   * Anonymous: the app attests on launch, before anyone has logged in, so
   * there is no user to record. The key is stored against the device instead
   * and claimed by the first user who proves possession of it (see
   * `verifyIosAssertion`). The challenge must have been issued to the same
   * device — that is what ties this call to the one that fetched the nonce.
   */
  async registerIosKey(input: {
    keyId: string;
    attestation: string;
    challenge: string;
    deviceId: string;
  }): Promise<IntegrityVerdict> {
    // Spend the challenge FIRST: an attestation that fails must still burn it,
    // or a captured one can be retried until it is accepted.
    if (!(await this.challenges.consume(input.challenge, input.deviceId))) {
      return {
        ok: false,
        platform: 'ios',
        reason: 'challenge is unknown, expired, already used or was issued to another device',
      };
    }

    const result = await this.ios.verifyAttestation({
      keyId: input.keyId,
      attestationBase64: input.attestation,
      challenge: input.challenge,
    });
    if (!result.ok || !result.publicKey) {
      return { ok: false, platform: 'ios', reason: result.reason };
    }

    await this.keys.save({
      keyId: input.keyId,
      username: unboundKeyOwner(input.deviceId),
      publicKey: result.publicKey,
      signCount: result.signCount ?? 0,
    });
    return { ok: true, platform: 'ios' };
  }

  /**
   * iOS per-request proof.
   *
   * Ownership is checked only when there IS a caller: on the pre-login routes
   * (login itself is attested) the signature alone is the proof, and the
   * first assertion made WITH a session claims a key that was registered
   * anonymously. After that the key answers for that user only.
   */
  async verifyIosAssertion(input: {
    keyId: string;
    assertion: string;
    challenge: string;
    username: string;
  }): Promise<IntegrityVerdict> {
    if (!(await this.challenges.consume(input.challenge))) {
      return {
        ok: false,
        platform: 'ios',
        reason: 'challenge is unknown, expired or already used',
      };
    }

    const stored = await this.keys.find(input.keyId);
    if (!stored) return { ok: false, platform: 'ios', reason: 'key is not registered' };

    const caller = input.username.trim();
    const unbound = isUnboundKeyOwner(stored.username);
    // A key belongs to the person who first proved it; accepting someone
    // else's would let one device speak for another account.
    if (caller && !unbound && stored.username.toUpperCase() !== caller.toUpperCase()) {
      return { ok: false, platform: 'ios', reason: 'key belongs to another user' };
    }

    const result = await this.ios.verifyAssertion({
      assertionBase64: input.assertion,
      clientDataHash: createHash('sha256').update(input.challenge).digest(),
      publicKey: stored.publicKey,
      previousSignCount: stored.signCount,
    });
    if (!result.ok) return { ok: false, platform: 'ios', reason: result.reason };

    // Only a VALID signature claims the key — binding before verifying would
    // let a bogus assertion pin someone else's device to this account.
    if (caller && unbound) await this.keys.bind(input.keyId, caller);
    await this.keys.updateSignCount(input.keyId, result.signCount ?? stored.signCount + 1);
    return { ok: true, platform: 'ios' };
  }

  /** Android per-request proof; `requestHash` binds it to this body. */
  verifyAndroidToken(token: string, requestHash?: string): Promise<IntegrityVerdict> {
    return this.android.verifyToken(token, requestHash);
  }

  /** SHA-256 of the raw body, matching what the client hashes. */
  static hashBody(body: unknown): string {
    return createHash('sha256')
      .update(typeof body === 'string' ? body : JSON.stringify(body ?? {}))
      .digest('hex');
  }
}
