import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthConfig } from '../config/configuration';
import { AuthenticatedUser, Role } from './auth-user.interface';
import { TokenRevocationService } from './token-revocation.service';

interface JwtPayload {
  sub?: string;
  username?: string;
  employeeNumber?: string;
  enum?: string;
  roles?: Role[];
  functions?: string[];
  name?: string;
  dept?: string;
  company?: string;
  /** Token id — revocable via /auth/logout and refresh rotation. */
  jti?: string;
  /** 'refresh' marks a refresh token, accepted ONLY by /auth/token/refresh. */
  typ?: string;
  [key: string]: unknown;
}

/**
 * Verifies the bearer JWT and maps claims → AuthenticatedUser.
 * Rejects refresh tokens used as access tokens (typ=refresh) and tokens
 * revoked by /auth/logout (jti denylist).
 * NOTE: op-1 login is out-of-band; issuer/audience checks are intentionally
 * relaxed until the auth spec lands (see Docs_Ai README known gaps).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly revocation: TokenRevocationService,
  ) {
    const auth = config.getOrThrow<AuthConfig>('auth');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: auth.jwtSecret,
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    if (payload.typ === 'refresh') {
      throw new UnauthorizedException('A refresh token cannot be used to access the API.');
    }
    if (payload.jti && this.revocation.isRevoked(payload.jti)) {
      throw new UnauthorizedException('This session has been logged out.');
    }
    return {
      username: payload.username ?? payload.sub ?? 'unknown',
      employeeNumber: payload.employeeNumber ?? payload.enum ?? payload.sub,
      roles: payload.roles ?? [Role.EMPLOYEE],
      functions: payload.functions,
      employeeName: payload.name,
      department: payload.dept,
      company: payload.company,
      claims: payload,
    };
  }
}
