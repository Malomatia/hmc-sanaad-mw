import { Injectable, Logger } from '@nestjs/common';
import { verifyAssertion, verifyAttestation } from 'node-app-attest';
import { AppIntegrityConfig } from '@core/config/configuration';
import { IosAttestationPort } from '../../domain/ports/integrity.ports';

/**
 * Apple App Attest, verified locally.
 *
 * There is no Apple endpoint that validates an attestation — the widely copied
 * `validate_device_token` call belongs to DeviceCheck, a different and older
 * feature, and neither accepts an attestation object nor returns a public key.
 * Verification means parsing the CBOR and checking its certificate chain
 * against Apple's App Attest root CA, which is what the library does. A client
 * must never be trusted to verify itself.
 *
 * Needs no Apple secret: a Team ID and bundle id are the whole configuration.
 */
@Injectable()
export class AppleAppAttestAdapter implements IosAttestationPort {
  private static readonly log = new Logger(AppleAppAttestAdapter.name);

  constructor(private readonly cfg: AppIntegrityConfig['ios']) {}

  get enabled(): boolean {
    return this.cfg.enabled;
  }

  async verifyAttestation(input: {
    keyId: string;
    attestationBase64: string;
    challenge: string;
  }): Promise<{ ok: boolean; publicKey?: string; signCount?: number; reason?: string }> {
    if (!this.enabled) return { ok: false, reason: 'iOS attestation is not configured' };

    try {
      const result = verifyAttestation({
        attestation: Buffer.from(input.attestationBase64, 'base64'),
        challenge: input.challenge,
        keyId: input.keyId,
        bundleIdentifier: this.cfg.bundleId,
        teamIdentifier: this.cfg.teamId,
        allowDevelopmentEnvironment: this.cfg.allowDevelopment,
      }) as { publicKey: string; environment: string };

      if (result.environment === 'development' && !this.cfg.allowDevelopment) {
        // Belt and braces — the library checks this too, and a debug build
        // reaching production must not be registered as a real device.
        return { ok: false, reason: 'attestation came from the development environment' };
      }
      // A fresh key always starts at zero; assertions increment from there.
      return { ok: true, publicKey: result.publicKey, signCount: 0 };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  }

  async verifyAssertion(input: {
    assertionBase64: string;
    clientDataHash: Buffer;
    publicKey: string;
    previousSignCount: number;
  }): Promise<{ ok: boolean; signCount?: number; reason?: string }> {
    if (!this.enabled) return { ok: false, reason: 'iOS attestation is not configured' };

    try {
      const result = verifyAssertion({
        assertion: Buffer.from(input.assertionBase64, 'base64'),
        payload: input.clientDataHash,
        publicKey: input.publicKey,
        bundleIdentifier: this.cfg.bundleId,
        teamIdentifier: this.cfg.teamId,
        signCount: input.previousSignCount,
      }) as { signCount: number };

      // The counter must ADVANCE. A repeated or lower value is the signature
      // of a replayed assertion, which is the one attack this design exists to
      // stop, so it is checked here as well as inside the library.
      if (result.signCount <= input.previousSignCount) {
        return { ok: false, reason: 'assertion counter did not advance (replay)' };
      }
      return { ok: true, signCount: result.signCount };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  }
}

/** Bound when iOS attestation is unconfigured; refuses rather than pretends. */
@Injectable()
export class DisabledIosAttestation implements IosAttestationPort {
  readonly enabled = false;
  async verifyAttestation() {
    return { ok: false, reason: 'iOS attestation is not configured' };
  }
  async verifyAssertion() {
    return { ok: false, reason: 'iOS attestation is not configured' };
  }
}
