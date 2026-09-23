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
      bind: jest.fn().mockResolvedValue(undefined),
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
    deviceId: 'device-installation-1',
  };

  it('issues a challenge using the mobile device identifier without a username', async () => {
    const { service, challenges } = make();

    await expect(service.issueChallenge('device-installation-1')).resolves.toBe('nonce');
    expect(challenges.issue).toHaveBeenCalledWith('device-installation-1');
  });

  /**
   * Registration happens on launch, before login: there is no user, so the key
   * is stored against the device and claimed later by the first assertion
   * made with a session.
   */
  describe('iOS registration (anonymous)', () => {
    it('stores the public key against the device when the attestation verifies', async () => {
      const { service, keys } = make();

      await expect(service.registerIosKey(REGISTER)).resolves.toMatchObject({ ok: true });
      expect(keys.save).toHaveBeenCalledWith(
        expect.objectContaining({
          keyId: 'k1',
          username: 'device:device-installation-1',
          publicKey: 'pk',
        }),
      );
    });

    it('spends the challenge only if it was issued to the same device', async () => {
      const { service, challenges } = make();

      await service.registerIosKey(REGISTER);

      expect(challenges.consume).toHaveBeenCalledWith('nonce', 'device-installation-1');
    });

    it('refuses a challenge that was never issued, expired, spent, or belongs to another device', async () => {
      const { service, ios, keys } = make({ consume: false });

      await expect(service.registerIosKey(REGISTER)).resolves.toMatchObject({ ok: false });
      // Not even parsed — a stale challenge is refused before any crypto work.
      expect(ios.verifyAttestation).not.toHaveBeenCalled();
      expect(keys.save).not.toHaveBeenCalled();
    });

    it('spends the challenge even when the attestation then fails', async () => {
      // Otherwise a captured attestation could be retried until accepted.
      const { service, challenges, keys } = make({
        attestation: { ok: false, reason: 'bad chain' },
      });

      await service.registerIosKey(REGISTER);

      expect(challenges.consume).toHaveBeenCalledWith('nonce', 'device-installation-1');
      expect(keys.save).not.toHaveBeenCalled();
    });

    it('keeps the device marker inside the 100-character LoginID column', async () => {
      const { service, keys } = make();

      await service.registerIosKey({ ...REGISTER, deviceId: 'd'.repeat(100) });

      const saved = keys.save.mock.calls[0][0];
      expect(saved.username.startsWith('device:')).toBe(true);
      expect(saved.username.length).toBeLessThanOrEqual(100);
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
      const { service, ios } = make({
        key: { username: 'SOMEONE_ELSE', publicKey: 'pk', signCount: 1 },
      });

      await expect(service.verifyIosAssertion(ASSERT)).resolves.toMatchObject({
        ok: false,
        reason: 'key belongs to another user',
      });
      expect(ios.verifyAssertion).not.toHaveBeenCalled();
    });

    it('does not let the same user match case-insensitively by accident on another login', async () => {
      const { service } = make({
        key: { username: 'aibrahim39', publicKey: 'pk', signCount: 1 },
      });

      await expect(service.verifyIosAssertion(ASSERT)).resolves.toMatchObject({ ok: true });
    });

    describe('a key registered before login', () => {
      const UNBOUND = { username: 'device:device-installation-1', publicKey: 'pk', signCount: 0 };

      it('is claimed by the first user who signs with it — after the signature verifies', async () => {
        const { service, keys, ios } = make({ key: UNBOUND });

        await expect(service.verifyIosAssertion(ASSERT)).resolves.toMatchObject({ ok: true });

        expect(keys.bind).toHaveBeenCalledWith('k1', 'AIBRAHIM39');
        expect(keys.bind.mock.invocationCallOrder[0]).toBeGreaterThan(
          ios.verifyAssertion.mock.invocationCallOrder[0],
        );
        expect(keys.updateSignCount).toHaveBeenCalledWith('k1', 5);
      });

      it('is NOT claimed by a bogus signature', async () => {
        const { service, keys } = make({
          key: UNBOUND,
          assertion: { ok: false, reason: 'signature invalid' },
        });

        await expect(service.verifyIosAssertion(ASSERT)).resolves.toMatchObject({ ok: false });
        expect(keys.bind).not.toHaveBeenCalled();
        expect(keys.updateSignCount).not.toHaveBeenCalled();
      });

      it('answers for the claiming user only, from then on', async () => {
        const { service } = make({
          key: { username: 'AIBRAHIM39', publicKey: 'pk', signCount: 5 },
        });

        await expect(
          service.verifyIosAssertion({ ...ASSERT, username: 'SOMEONE_ELSE' }),
        ).resolves.toMatchObject({ ok: false, reason: 'key belongs to another user' });
      });
    });

    describe('a request with no session (login itself is attested)', () => {
      const ANONYMOUS = { ...ASSERT, username: '' };

      it('is judged on the signature alone and does not claim the key', async () => {
        const { service, keys } = make({
          key: { username: 'device:device-installation-1', publicKey: 'pk', signCount: 0 },
        });

        await expect(service.verifyIosAssertion(ANONYMOUS)).resolves.toMatchObject({ ok: true });
        expect(keys.bind).not.toHaveBeenCalled();
        expect(keys.updateSignCount).toHaveBeenCalledWith('k1', 5);
      });

      it('is accepted from a key already bound to someone — the device is genuine either way', async () => {
        const { service, keys } = make();

        await expect(service.verifyIosAssertion(ANONYMOUS)).resolves.toMatchObject({ ok: true });
        expect(keys.bind).not.toHaveBeenCalled();
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
