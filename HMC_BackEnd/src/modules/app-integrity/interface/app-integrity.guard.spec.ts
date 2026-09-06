import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
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
 * than its feature. Enforcement rejects real devices â€” a phone without Play
 * Services, a rooted handset, a sideloaded build, a simulator â€” so the staging
 * (`off` â†’ `observe` â†’ `enforce`) is what keeps this from locking users out,
 * and these cases pin it.
 */
describe('AppIntegrityGuard', () => {
  function make(
    mode: 'off' | 'observe' | 'enforce',
    verdicts: { ios?: boolean; android?: boolean } = {},
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
      }),
    } as unknown as ConfigService;
    return {
      guard: new AppIntegrityGuard(new Reflector(), service, config),
      service,
    };
  }

  function context(
    headers: Record<string, string> = {},
    body: unknown = {},
    skip = false,
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
          url: '/api/v1/leave/apply',
          user: { username: 'AIBRAHIM39' },
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it('off â€” allows everything and verifies nothing', async () => {
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

    it('exempts a @SkipIntegrity route â€” probes and consoles are not the app', async () => {
      const { guard } = make('enforce');

      await expect(guard.canActivate(context({}, {}, true))).resolves.toBe(true);
    });
  });
});
