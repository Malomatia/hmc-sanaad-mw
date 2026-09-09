import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { AuthenticatedUser, DEV_USER } from './auth-user.interface';

const IDENTITY_QUERY_KEY = /^(username|enum)(?:$|\[)/;

/**
 * Global bearer guard. Skips @Public() routes (the pre-login auth journey
 * proxied verbatim to HMC_BackEnd, plus /health). Everything else — in
 * particular the generic proxy wildcard — requires a valid bearer token,
 * verified locally without calling back into the backend. When
 * AUTH_DISABLED=true it injects a permissive DEV_USER for local development.
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
    const hasIdentityQuery = [...this.query(context).keys()].some((key) =>
      IDENTITY_QUERY_KEY.test(key),
    );
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic && !hasIdentityQuery) return true;

    if (this.authDisabled && !hasIdentityQuery) {
      const req = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
      req.user = req.user ?? DEV_USER;
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest<TUser = AuthenticatedUser>(
    err: unknown,
    user: TUser,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    const query = this.query(context);
    const identityQuery = [...query].filter(([key]) => IDENTITY_QUERY_KEY.test(key));
    if (err || !user) {
      if (identityQuery.length) this.rejectAction(context, query);
      throw err instanceof Error ? err : new UnauthorizedException('Unauthenticated');
    }

    const claims = (user as Pick<AuthenticatedUser, 'claims'>).claims;
    for (const [key, value] of identityQuery) {
      const claim =
        key === 'username' ? claims?.username : key === 'enum' ? claims?.employeeNumber : undefined;
      if (
        typeof claim !== 'string' ||
        !value ||
        value.toLowerCase() !== claim.toLowerCase() ||
        query.getAll(key).length !== 1
      ) {
        this.rejectAction(context, query);
      }
    }
    return user;
  }

  private query(context: ExecutionContext): URLSearchParams {
    const req = context.switchToHttp().getRequest<{ originalUrl?: string; url?: string }>();
    const url = req.originalUrl ?? req.url ?? '';
    const index = url.indexOf('?');
    return new URLSearchParams(index === -1 ? '' : url.slice(index + 1));
  }

  private rejectAction(context: ExecutionContext, query: URLSearchParams): never {
    const req = context.switchToHttp().getRequest<{
      headers?: { lang?: string | string[] };
    }>();
    const header = req.headers?.lang;
    const lang = query.get('lang') ?? (Array.isArray(header) ? header[0] : header);
    throw new UnauthorizedException(lang === 'ar' ? 'إجراء غير مصرح به' : 'Unauthorized action');
  }
}
