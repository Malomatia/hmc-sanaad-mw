import { AppIntegrityService } from './app-integrity.service';
import {
  AndroidIntegrityPort,
  AttestKeyStorePort,
  ChallengeStorePort,
  IosAttestationPort,
} from '../domain/ports/integrity.ports';

/**
 * The attacks this design exists to stop are replays: reusing a captured
 * attestation, reusing an assertion, or lifting a valid Android token onto a
 * different request. Each of those is a case below — they are the reason the
 * challenge is stored and the counter is tracked, rather than decoration.
 */
describe('AppIntegrityService', () => {
  function make(over: {
    consume?: boolean;
    key?: { username: string; publicKey: string; signCount: number };
    attestation?: { ok: boolean; publicKey?: string; reason?: string };
    assertion?: { ok: boolean; signCount?: number; reason?: string };
  } = {}) {
    const challenges = {
      issue: jest.fn().mockResolvedValue('nonce'),
      consume: jest.fn().mockResolvedValue(over.consume ?? true),
    } as unknown as jest.Mocked<ChallengeStorePort>;

    const keys = {
      save: jest.fn().mockResolvedValue(undefined),
      find: jest
        .fn()
        .mockResolvedValue(
          over.key === undefined
            ? { keyId: 'k1', username: 'AIBRAHIM39', publicKey: 'pk', signCount: 4 }
            : over.key && { keyId: 'k1', ...over.key },
        ),
      updateSignCount: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AttestKeyStorePort>;

    const ios = {
      enabled: true,
      verifyAttestation: jest.fn().mockResolvedValue(over.attestation ?? { ok: true, publicKey: 'pk', signCount: 0 }),
      verifyAssertion: jest.fn().mockResolvedValue(over.assertion ?? { ok: true, signCount: 5 }),
    } as unknown as jest.Mocked<IosAttestationPort>;

    const android = {
      enabled: true,
      verifyToken: jest.fn().mockResolvedValue({ ok: true, platform: 'android' }),
    } as unknown as jest.Mocked<AndroidIntegrityPort>;

    return { service: new AppIntegrityService(challenges, keys, ios, android), challenges, keys, ios, android };
  }

  const REGISTER = {
    keyId: 'k1',
    attestation: 'base64',
    challenge: 'nonce',
    username: 'AIBRAHIM39',
  };

  describe('iOS registration', () => {
    it('stores the public key when the attestation verifies', async () => {
      const { service, keys } = make();

      await expect(service.registerIosKey(REGISTER)).resolves.toMatchObject({ ok: true });
      expect(keys.save).toHaveBeenCalledWith(
        expect.objectContaining({ keyId: 'k1', username: 'AIBRAHIM39', publicKey: 'pk' }),
      );
    });

    it('refuses a challenge that was never issued, expired, or already spent', async () => {
      const { service, ios } = make({ consume: false });

      await expect(service.registerIosKey(REGISTER)).resolves.toMatchObject({ ok: false });
      // Not even parsed — a stale challenge is refused before any crypto work.
      expect(ios.verifyAttestation).not.toHaveBeenCalled();
    });

    it('spends the challenge even when the attestation then fails', async () => {
      // Otherwise a captured attestation could be retried until accepted.
      const { service, challenges, keys } = make({
        attestation: { ok: false, reason: 'bad chain' },
      });

      await service.registerIosKey(REGISTER);

      expect(challenges.consume).toHaveBeenCalledWith('nonce');
      expect(keys.save).not.toHaveBeenCalled();
    });
  });

  describe('iOS assertion', () => {
    const ASSERT = { keyId: 'k1', assertion: 'sig', challenge: 'nonce', username: 'AIBRAHIM39' };

    it('accepts a signature from a registered key and records the new counter', async () => {
      const { service, keys } = make();

      await expect(service.verifyIosAssertion(ASSERT)).resolves.toMatchObject({ ok: true });
      expect(keys.updateSignCount).toHaveBeenCalledWith('k1', 5);
    });

    it('refuses an unregistered key', async () => {
      const { service } = make({ key: null as never });

      await expect(service.verifyIosAssertion(ASSERT)).resolves.toMatchObject({
        ok: false,
        reason: 'key is not registered',
      });
    });

    it('refuses a key that belongs to a different user', async () => {
      const { service } = make({
        key: { username: 'SOMEONE_ELSE', publicKey: 'pk', signCount: 1 },
      });

      await expect(service.verifyIosAssertion(ASSERT)).resolves.toMatchObject({
        ok: false,
        reason: 'key belongs to another user',
      });
    });

    it('refuses a replayed assertion and leaves the counter alone', async () => {
      const { service, keys } = make({ assertion: { ok: false, reason: 'counter did not advance' } });

      await expect(service.verifyIosAssertion(ASSERT)).resolves.toMatchObject({ ok: false });
      expect(keys.updateSignCount).not.toHaveBeenCalled();
    });

    it('refuses a stale challenge before touching the key store', async () => {
      const { service, keys } = make({ consume: false });

      await expect(service.verifyIosAssertion(ASSERT)).resolves.toMatchObject({ ok: false });
      expect(keys.find).not.toHaveBeenCalled();
    });
  });

  describe('Android', () => {
    it('passes the request hash through so the token is bound to this body', async () => {
      const { service, android } = make();

      await service.verifyAndroidToken('tok', 'abc123');

      expect(android.verifyToken).toHaveBeenCalledWith('tok', 'abc123');
    });
  });

  describe('body hashing', () => {
    it('is stable for the same body', () => {
      const a = AppIntegrityService.hashBody({ x: 1 });
      const b = AppIntegrityService.hashBody({ x: 1 });

      expect(a).toBe(b);
      expect(a).toHaveLength(64);
    });

    it('changes when the body changes', () => {
      expect(AppIntegrityService.hashBody({ x: 1 })).not.toBe(AppIntegrityService.hashBody({ x: 2 }));
    });
  });
});
