import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { AppIntegrityConfig } from '@core/config/configuration';
import { SKIP_INTEGRITY_KEY } from '@core/integrity/skip-integrity.decorator';
import { IntegrityVerdict } from '../domain/attestation';
import { AppIntegrityMetrics, ObservedPlatform } from '../application/app-integrity.metrics';
import { AppIntegrityService } from '../application/app-integrity.service';

/** Headers the app sends. One platform per request, never both. */
export const IOS_ASSERTION_HEADER = 'x-ios-assertion';
export const IOS_KEY_ID_HEADER = 'x-ios-key-id';
export const INTEGRITY_CHALLENGE_HEADER = 'x-integrity-challenge';
export const ANDROID_TOKEN_HEADER = 'x-integrity-token';
export const ANDROID_REQUEST_HASH_HEADER = 'x-integrity-request-hash';

/** SHA-256 as the client sends it. */
const SHA256_HEX = /^[a-f0-9]{64}$/i;

/**
 * Enforces device attestation on incoming requests.
 *
 * Reuses `@SkipIntegrity()` rather than adding a second decorator: both
 * mechanisms answer the same question, and the routes exempt from one - health
 * probes, diagnostics, the dev console - are exactly the routes exempt from
 * the other.
 *
 * ## Why the default is `off`, and why `observe` exists
 *
 * Enforcement rejects real devices. Play Integrity refuses a phone without
 * Play Services, a rooted device and a sideloaded build; App Attest refuses a
 * simulator. Switching straight to `enforce` would lock those users out with
 * no warning, so `observe` verifies and reports what WOULD have been rejected
 * while letting everything through. Read the logs before you act on them.
 */
@Injectable()
export class AppIntegrityGuard implements CanActivate {
  private static readonly log = new Logger(AppIntegrityGuard.name);
  private readonly cfg: AppIntegrityConfig;

  constructor(
    private readonly reflector: Reflector,
    private readonly service: AppIntegrityService,
    config: ConfigService,
    // Optional so a unit test can build the guard with three arguments; the
    // counters are a side channel, never a reason for the guard not to exist.
    @Optional() private readonly metrics: AppIntegrityMetrics = new AppIntegrityMetrics(),
  ) {
    this.cfg = config.getOrThrow<AppIntegrityConfig>('appIntegrity');
    if (this.cfg.mode === 'off') return;

    AppIntegrityGuard.log.log(
      `App integrity is ${this.cfg.mode} ` +
        `(iOS ${this.cfg.ios.enabled ? 'ready' : 'NOT configured'}, ` +
        `Android ${this.cfg.android.enabled ? 'ready' : 'NOT configured'}).`,
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.cfg.mode === 'off') return true;

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_INTEGRITY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      body?: unknown;
      rawBody?: Buffer;
      url?: string;
      user?: AuthenticatedUser;
    }>();
    const route = req.url ?? '';
    const verdict = await this.verify(req);
    this.metrics.record({
      platform: AppIntegrityGuard.observedPlatform(req.headers, verdict),
      ok: verdict.ok,
      reason: verdict.reason,
      route,
    });

    if (verdict.ok) return true;
    return this.reject(route, verdict);
  }

  /**
   * What the request CLAIMED to be, for the counters: a call with no headers
   * at all is neither an iOS nor an Android failure, and counting it as one
   * would make the per-platform rollout numbers meaningless.
   */
  private static observedPlatform(
    headers: Record<string, string | undefined>,
    verdict: IntegrityVerdict,
  ): ObservedPlatform {
    if (headers[ANDROID_TOKEN_HEADER]) return 'android';
    if (headers[IOS_ASSERTION_HEADER]) return 'ios';
    return verdict.ok ? verdict.platform : 'none';
  }

  private async verify(req: {
    headers: Record<string, string | undefined>;
    body?: unknown;
    rawBody?: Buffer;
    user?: AuthenticatedUser;
  }): Promise<IntegrityVerdict> {
    const androidToken = req.headers[ANDROID_TOKEN_HEADER];
    if (androidToken) {
      const claimed = req.headers[ANDROID_REQUEST_HASH_HEADER];
      // Absent, the token is bound to nothing: a genuine one captured from any
      // request can be replayed onto a different call simply by leaving the
      // header off. That is most of what Play Integrity buys over "is the app
      // real", so enforcement requires it.
      if (!claimed) {
        if (this.cfg.mode === 'enforce' && this.cfg.requireRequestHash) {
          return { ok: false, platform: 'android', reason: 'request hash header is missing' };
        }
        return this.service.verifyAndroidToken(androidToken, undefined);
      }
      if (!SHA256_HEX.test(claimed)) {
        return {
          ok: false,
          platform: 'android',
          reason: 'request hash is not a SHA-256 hex digest',
        };
      }
      // Only trust the client's hash if it matches the body we received. The
      // RAW bytes, not a re-serialization of them - the client hashed exactly
      // what it put on the wire.
      const actual = AppIntegrityService.hashBody(req.rawBody ?? req.body);
      if (claimed.toLowerCase() !== actual.toLowerCase()) {
        return { ok: false, platform: 'android', reason: 'request hash does not match the body' };
      }
      return this.service.verifyAndroidToken(androidToken, claimed);
    }

    const assertion = req.headers[IOS_ASSERTION_HEADER];
    const keyId = req.headers[IOS_KEY_ID_HEADER];
    const challenge = req.headers[INTEGRITY_CHALLENGE_HEADER];
    if (assertion && keyId && challenge) {
      return this.service.verifyIosAssertion({
        keyId,
        assertion,
        challenge,
        username: req.user?.username ?? '',
      });
    }

    return { ok: false, platform: 'ios', reason: 'no attestation headers were sent' };
  }

  /** Observe -> log what would have happened. Enforce -> 401. */
  private reject(route: string, verdict: IntegrityVerdict): boolean {
    const detail = `${verdict.platform}: ${verdict.reason ?? 'verification failed'}`;
    if (this.cfg.mode === 'observe') {
      AppIntegrityGuard.log.warn(`App integrity (observe) would reject ${route} - ${detail}`);
      return true;
    }
    AppIntegrityGuard.log.warn(`App integrity rejected ${route} - ${detail}`);
    throw new UnauthorizedException('This request did not come from a verified app.');
  }
}
