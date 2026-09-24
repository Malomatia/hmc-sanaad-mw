import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AppIntegrityMetrics } from '../application/app-integrity.metrics';
import { AppIntegrityService } from '../application/app-integrity.service';
import {
  ANDROID_REQUEST_HASH_HEADER,
  ANDROID_TOKEN_HEADER,
  AppIntegrityGuard,
  INTEGRITY_CHALLENGE_HEADER,
  IOS_ASSERTION_HEADER,
  IOS_KEY_ID_HEADER,
} from './app-integrity.guard';
import { SKIP_INTEGRITY_KEY } from '@core/integrity/skip-integrity.decorator';

/**
 * The guard sits in front of every route, so its failure mode matters more
 * than its feature. Enforcement rejects real devices - a phone without Play
 * Services, a rooted handset, a sideloaded build, a simulator - so the staging
 * (`off` -> `observe` -> `enforce`) is what keeps this from locking users out,
 * and these cases pin it.
 */
describe('AppIntegrityGuard', () => {
  function make(
    mode: 'off' | 'observe' | 'enforce',
    verdicts: { ios?: boolean; android?: boolean; requireRequestHash?: boolean } = {},
  ) {
    const service = {
      verifyIosAssertion: jest
        .fn()
        .mockResolvedValue({ ok: verdicts.ios ?? true, platform: 'ios', reason: 'nope' }),
      verifyAndroidToken: jest
        .fn()
        .mockResolvedValue({ ok: verdicts.android ?? true, platform: 'android', reason: 'nope' }),
    } as unknown as jest.Mocked<AppIntegrityService>;
    const config = {
      getOrThrow: () => ({
        mode,
        ios: { enabled: true },
        android: { enabled: true },
        challengeTtlMs: 1000,
        requireRequestHash: verdicts.requireRequestHash ?? false,
      }),
    } as unknown as ConfigService;
    const metrics = new AppIntegrityMetrics();
    return {
      guard: new AppIntegrityGuard(new Reflector(), service, config, metrics),
      service,
      metrics,
    };
  }

  function context(
    headers: Record<string, string> = {},
    body: unknown = {},
    skip = false,
    rawBody?: Buffer,
  ): ExecutionContext {
    const handler = () => undefined;
    class Controller {}
    if (skip) Reflect.defineMetadata(SKIP_INTEGRITY_KEY, true, handler);
    return {
      getHandler: () => handler,
      getClass: () => Controller,
      switchToHttp: () => ({
        getRequest: () => ({
          headers,
          body,
          rawBody,
          url: '/api/v1/leave/apply',
          user: { username: 'AIBRAHIM39' },
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it('off - allows everything and verifies nothing', async () => {
    const { guard, service } = make('off');

    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(service.verifyAndroidToken).not.toHaveBeenCalled();
  });

  describe('observe', () => {
    it('allows a request with no attestation at all', async () => {
      const { guard } = make('observe');

      await expect(guard.canActivate(context())).resolves.toBe(true);
    });

    it('allows one that failed verification, so nobody is locked out while measuring', async () => {
      const { guard } = make('observe', { android: false });

      await expect(
        guard.canActivate(context({ [ANDROID_TOKEN_HEADER]: 'tok' })),
      ).resolves.toBe(true);
    });

    it('allows an Android request with no hash header even when it would be required', async () => {
      // Old client builds are exactly what observe mode is there to count.
      const { guard } = make('observe', { requireRequestHash: true });

      await expect(guard.canActivate(context({ [ANDROID_TOKEN_HEADER]: 'tok' }))).resolves.toBe(
        true,
      );
    });

    it('counts what enforcement would have refused, by platform and reason', async () => {
      // The rollout decision is made from these numbers, not from log lines.
      const { guard, metrics } = make('observe', { android: false });

      await guard.canActivate(context({ [ANDROID_TOKEN_HEADER]: 'tok' }));
      await guard.canActivate(context());

      const snapshot = metrics.snapshot();
      expect(snapshot.observed).toBe(2);
      expect(snapshot.failed).toBe(2);
      expect(snapshot.byPlatform.android).toEqual({ observed: 1, passed: 0, failed: 1 });
      expect(snapshot.byPlatform.none.failed).toBe(1);
      expect(snapshot.byReason).toContainEqual({ platform: 'android', reason: 'nope', count: 1 });
      expect(snapshot.lastFailure?.platform).toBe('none');
    });
  });

  describe('enforce', () => {
    it('accepts a valid Android token', async () => {
      const { guard } = make('enforce');

      await expect(
        guard.canActivate(context({ [ANDROID_TOKEN_HEADER]: 'tok' })),
      ).resolves.toBe(true);
    });

    it('accepts a valid iOS assertion', async () => {
      const { guard } = make('enforce');

      await expect(
        guard.canActivate(
          context({
            [IOS_ASSERTION_HEADER]: 'sig',
            [IOS_KEY_ID_HEADER]: 'k1',
            [INTEGRITY_CHALLENGE_HEADER]: 'nonce',
          }),
        ),
      ).resolves.toBe(true);
    });

    it('rejects a request carrying no attestation', async () => {
      const { guard } = make('enforce');

      await expect(guard.canActivate(context())).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a token whose request hash does not match the body it arrived with', async () => {
      // The whole point of the hash: a genuine token lifted onto another call.
      const { guard, service } = make('enforce');

      await expect(
        guard.canActivate(
          context(
            { [ANDROID_TOKEN_HEADER]: 'tok', [ANDROID_REQUEST_HASH_HEADER]: 'not-the-hash' },
            { amount: 1000 },
          ),
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(service.verifyAndroidToken).not.toHaveBeenCalled();
    });

    it('accepts a hash that does match', async () => {
      const { guard } = make('enforce');
      const body = { leave: 'casual' };

      await expect(
        guard.canActivate(
          context(
            {
              [ANDROID_TOKEN_HEADER]: 'tok',
              [ANDROID_REQUEST_HASH_HEADER]: AppIntegrityService.hashBody(body),
            },
            body,
          ),
        ),
      ).resolves.toBe(true);
    });

    it('rejects an Android token sent with no request hash at all', async () => {
      // Omitting the header would otherwise bind the token to nothing, which
      // is the same replay the hash exists to stop.
      const { guard, service } = make('enforce', { requireRequestHash: true });

      await expect(
        guard.canActivate(context({ [ANDROID_TOKEN_HEADER]: 'tok' }, { amount: 1000 })),
      ).rejects.toThrow(UnauthorizedException);
      expect(service.verifyAndroidToken).not.toHaveBeenCalled();
    });

    it('hashes the bytes RECEIVED, not a re-serialization of the parsed body', async () => {
      // Key order and whitespace survive the wire but not JSON.parse, so
      // hashing req.body would refuse honest clients.
      const { guard } = make('enforce', { requireRequestHash: true });
      const raw = Buffer.from('{"b":2,"a":1}', 'utf8');

      await expect(
        guard.canActivate(
          context(
            {
              [ANDROID_TOKEN_HEADER]: 'tok',
              [ANDROID_REQUEST_HASH_HEADER]: AppIntegrityService.hashBody(raw),
            },
            { a: 1, b: 2 },
            false,
            raw,
          ),
        ),
      ).resolves.toBe(true);
    });

    it('exempts a @SkipIntegrity route - probes and consoles are not the app', async () => {
      const { guard } = make('enforce');

      await expect(guard.canActivate(context({}, {}, true))).resolves.toBe(true);
    });
  });
});
