import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { AuthenticatedUser, DEV_USER } from './auth-user.interface';
import { ERROR_MESSAGES } from '@shared/constants/error-codes';
import { BadRequestException } from '@nestjs/common';
import { VERSION_METADATA } from '@nestjs/common/constants';
import { currentIdentity } from './current-identity';
import { normalizePersonId } from '@shared/domain/caller-identity';

/**
 * Global bearer guard. Skips @Public() routes. When AUTH_DISABLED=true it
 * injects a permissive DEV_USER so local development works without the
 * (pending) auth spec.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly authDisabled: boolean;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService,
  ) {
    super();
    this.authDisabled = config.get<boolean>('auth.disabled', false);
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const version = this.reflector.getAllAndOverride<string | string[]>(VERSION_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (version === '2' || (Array.isArray(version) && version.includes('2'))) {
      return this.verifyV2(context);
    }

    if (this.authDisabled) {
      const req = context
        .switchToHttp()
        .getRequest<{ user?: AuthenticatedUser; headers?: Record<string, unknown> }>();
      req.user = req.user ?? this.devUserFrom(req.headers) ?? DEV_USER;
      return true;
    }

    return super.canActivate(context);
  }

  /**
   * With auth disabled, take the identity from the presented token instead of
   * pinning every request to DEV_USER.
   *
   * DEV_USER is a single fixed person, so testing anything person-specific was
   * impossible: logging in as an approver returned a token for them, and then
   * every subsequent request was still treated as DEV_USER — so their queue
   * came back empty and there was no way to exercise an approver journey at
   * all. The roles stay permissive, since AUTH_DISABLED means "no
   * authorization either".
   *
   * The token is DECODED, not verified — there is nothing to verify against
   * when auth is switched off, and this branch never runs otherwise.
   */
  private devUserFrom(headers?: Record<string, unknown>): AuthenticatedUser | undefined {
    const header = String(headers?.authorization ?? '');
    const jwt = header.replace(/^Bearer\s+/i, '');
    const payload = jwt.split('.')[1];
    if (!payload) return undefined;
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64').toString()) as Record<
        string,
        unknown
      >;
      const username = claims.username ?? claims.sub;
      if (!username) return undefined;
      return {
        ...DEV_USER,
        username: String(username),
        employeeNumber: claims.employeeNumber ? String(claims.employeeNumber) : undefined,
        personId: normalizePersonId(claims.person_id),
        employeeName: claims.name ? String(claims.name) : DEV_USER.employeeName,
        claims,
      } as AuthenticatedUser;
    } catch {
      return undefined;
    }
  }

  private async verifyV2(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    const req = context.switchToHttp().getRequest<{
      user: AuthenticatedUser;
      originalUrl?: string;
      url?: string;
    }>();
    req.user = currentIdentity(req.user);
    const url = req.originalUrl ?? req.url ?? '';
    const query = new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?') + 1) : '');
    for (const key of query.keys()) {
      if (/^(username|enum|person_id|user_name)(?:$|\[)/i.test(key)) {
        throw new BadRequestException('Identity query parameters are not accepted in v2; use the access token.');
      }
    }
    return true;
  }

  handleRequest<TUser = AuthenticatedUser>(err: unknown, user: TUser): TUser {
    if (err || !user) {
      throw err instanceof Error ? err : new UnauthorizedException(ERROR_MESSAGES.UNAUTHENTICATED);
    }
    return user;
  }
}
