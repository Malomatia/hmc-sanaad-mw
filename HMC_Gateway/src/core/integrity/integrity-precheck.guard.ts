import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { IntegrityConfig } from '../config/configuration';

/** Headers the app sends. One platform per request, never both. */
const ANDROID_TOKEN = 'x-integrity-token';
const ANDROID_REQUEST_HASH = 'x-integrity-request-hash';
const IOS_ASSERTION = 'x-ios-assertion';
const IOS_KEY_ID = 'x-ios-key-id';
const IOS_CHALLENGE = 'x-integrity-challenge';

/** Below this a value cannot be a real token; above it, nobody sends one. */
const MIN_TOKEN_LENGTH = 20;
const MAX_TOKEN_LENGTH = 8192;

/** SHA-256 as the client sends it. */
const SHA256_HEX = /^[a-f0-9]{64}$/i;

/**
 * First-pass attestation check at the edge.
 *
 * The gateway holds no database and no platform credentials — that is
 * deliberate, it is a security layer and not a second service — so it checks
 * only what needs neither:
 *
 *   1. are the attestation headers present at all,
 *   2. are they shaped like real values rather than noise,
 *   3. does the request hash match the body actually received.
 *
 * Whether a signature is genuine — Apple's certificate chain, Google's
 * verdicts, a challenge that has not already been spent, a counter that
 * advanced — needs stored state, and stays in the backend. This is defence in
 * depth, not a move: nothing was taken away from there.
 *
 * The third check is the one with real teeth. It costs nothing and it catches
 * a genuine token being lifted onto a different request, which is most of what
 * Play Integrity offers over a plain "is the app real" test.
 *
 * ## Why the default is off
 *
 * Enforcement rejects real devices — no Play Services, rooted, sideloaded, a
 * simulator. `observe` reports what WOULD have been refused while letting
 * everything through; read those numbers before switching.
 */
@Injectable()
export class IntegrityPreCheckGuard implements CanActivate {
  private static readonly log = new Logger(IntegrityPreCheckGuard.name);
  private readonly cfg: IntegrityConfig;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<IntegrityConfig>('integrity');
    if (this.cfg.mode !== 'off') {
      IntegrityPreCheckGuard.log.log(`Gateway integrity pre-check is ${this.cfg.mode}.`);
    }
  }

  canActivate(context: ExecutionContext): boolean {
    if (this.cfg.mode === 'off') return true;

    // @Public() is the pre-login journey — healthcheck, OTP, MPIN, login.
    // A device has no session yet there, and blocking it would lock the app
    // out at the door rather than protecting anything.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      rawBody?: Buffer;
      body?: unknown;
      originalUrl?: string;
    }>();

    const problem = this.inspect(req);
    if (!problem) return true;
    return this.reject(req.originalUrl ?? '', problem);
  }

  /** The reason to refuse, or undefined when the request looks plausible. */
  private inspect(req: {
    headers: Record<string, string | undefined>;
    rawBody?: Buffer;
    body?: unknown;
  }): string | undefined {
    const androidToken = req.headers[ANDROID_TOKEN];
    const assertion = req.headers[IOS_ASSERTION];

    if (androidToken) return this.inspectAndroid(req, androidToken);
    if (assertion) return this.inspectIos(req.headers, assertion);
    return 'no attestation headers were sent';
  }

  private inspectAndroid(
    req: { headers: Record<string, string | undefined>; rawBody?: Buffer; body?: unknown },
    token: string,
  ): string | undefined {
    const malformed = this.checkShape(token, 'integrity token');
    if (malformed) return malformed;

    const claimed = req.headers[ANDROID_REQUEST_HASH];
    if (!claimed) return undefined; // optional; the backend still verifies the token
    if (!SHA256_HEX.test(claimed)) return 'request hash is not a SHA-256 hex digest';

    // Hash the bytes we RECEIVED. Re-serializing first would compare a
    // different string to the one the client hashed and refuse honest traffic.
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const actual = createHash('sha256').update(raw).digest('hex');
    if (actual.toLowerCase() !== claimed.toLowerCase()) {
      return 'request hash does not match the body';
    }
    return undefined;
  }

  private inspectIos(
    headers: Record<string, string | undefined>,
    assertion: string,
  ): string | undefined {
    if (!headers[IOS_KEY_ID]) return 'iOS assertion sent without a key id';
    if (!headers[IOS_CHALLENGE]) return 'iOS assertion sent without a challenge';
    return this.checkShape(assertion, 'iOS assertion');
  }

  /** Cheap sanity: right length, and base64-ish rather than arbitrary text. */
  private checkShape(value: string, label: string): string | undefined {
    if (value.length < MIN_TOKEN_LENGTH) return `${label} is too short to be real`;
    if (value.length > MAX_TOKEN_LENGTH) return `${label} is implausibly long`;
    if (!/^[A-Za-z0-9+/=_.-]+$/.test(value)) return `${label} contains unexpected characters`;
    return undefined;
  }

  /** Observe → say what would have happened. Enforce → 401. */
  private reject(route: string, reason: string): boolean {
    if (this.cfg.mode === 'observe') {
      IntegrityPreCheckGuard.log.warn(`Integrity (observe) would reject ${route} — ${reason}`);
      return true;
    }
    IntegrityPreCheckGuard.log.warn(`Integrity rejected ${route} — ${reason}`);
    throw new UnauthorizedException('This request did not come from a verified app.');
  }
}
