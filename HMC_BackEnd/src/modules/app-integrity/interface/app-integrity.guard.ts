import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { AppIntegrityConfig } from '@core/config/configuration';
import { SKIP_INTEGRITY_KEY } from '@core/integrity/skip-integrity.decorator';
import { IntegrityVerdict } from '../domain/attestation';
import { AppIntegrityService } from '../application/app-integrity.service';

/** Headers the app sends. One platform per request, never both. */
export const IOS_ASSERTION_HEADER = 'x-ios-assertion';
export const IOS_KEY_ID_HEADER = 'x-ios-key-id';
export const INTEGRITY_CHALLENGE_HEADER = 'x-integrity-challenge';
export const ANDROID_TOKEN_HEADER = 'x-integrity-token';
export const ANDROID_REQUEST_HASH_HEADER = 'x-integrity-request-hash';

/**
 * Enforces device attestation on incoming requests.
 *
 * Reuses `@SkipIntegrity()` rather than adding a second decorator: both
 * mechanisms answer the same question, and the routes exempt from one â€” health
 * probes, diagnostics, the dev console â€” are exactly the routes exempt from
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
      url?: string;
      user?: AuthenticatedUser;
    }>();
    const route = req.url ?? '';
    const verdict = await this.verify(req);

    if (verdict.ok) return true;
    return this.reject(route, verdict);
  }

  private async verify(req: {
    headers: Record<string, string | undefined>;
    body?: unknown;
    user?: AuthenticatedUser;
  }): Promise<IntegrityVerdict> {
    const androidToken = req.headers[ANDROID_TOKEN_HEADER];
    if (androidToken) {
      // Only trust the client's hash if it matches the body we received.
      const claimed = req.headers[ANDROID_REQUEST_HASH_HEADER];
      const actual = AppIntegrityService.hashBody(req.body);
      if (claimed && claimed !== actual) {
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

  /** Observe â†’ log what would have happened. Enforce â†’ 401. */
  private reject(route: string, verdict: IntegrityVerdict): boolean {
    const detail = `${verdict.platform}: ${verdict.reason ?? 'verification failed'}`;
    if (this.cfg.mode === 'observe') {
      AppIntegrityGuard.log.warn(`App integrity (observe) would reject ${route} â€” ${detail}`);
      return true;
    }
    AppIntegrityGuard.log.warn(`App integrity rejected ${route} â€” ${detail}`);
    throw new UnauthorizedException('This request did not come from a verified app.');
  }
}
