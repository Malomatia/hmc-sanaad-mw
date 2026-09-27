import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthConfig } from '../config/configuration';
import { AuthenticatedUser, Role } from './auth-user.interface';

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
  [key: string]: unknown;
}

/**
 * Verifies the bearer JWT issued by HMC_BackEnd's /auth/login (API-5) and
 * maps claims → AuthenticatedUser. Deliberately mirrors HMC_BackEnd's
 * JwtStrategy so a token minted there verifies identically here — the
 * gateway never issues tokens, only validates them locally (shared
 * JWT_SECRET/JWT_ISSUER/JWT_AUDIENCE) so no round trip to the backend is
 * needed per request.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    const auth = config.getOrThrow<AuthConfig>('auth');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: auth.jwtSecret,
      algorithms: ['HS256'],
      issuer: auth.jwtIssuer,
      audience: auth.jwtAudience,
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    const now = Math.floor(Date.now() / 1000);
    if (!payload || payload.typ !== 'access' ||
        ['sub', 'username', 'deviceImei', 'sid', 'jti'].some((key) =>
          typeof payload[key] !== 'string' || !(payload[key] as string).trim() || (payload[key] as string).length > 256) ||
        !Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.iat) ||
        (payload.exp as number) <= now || (payload.iat as number) > now + 30 ||
        (payload.exp as number) <= (payload.iat as number) ||
        ['employeeNumber', 'enum', 'name', 'dept', 'company'].some((key) =>
          payload[key] !== undefined && typeof payload[key] !== 'string') ||
        ['roles', 'functions'].some((key) => payload[key] !== undefined &&
          (!Array.isArray(payload[key]) || !(payload[key] as unknown[]).every((value) => typeof value === 'string')))) {
      throw new UnauthorizedException('Invalid session token. Please log in again.');
    }
    return {
      username: payload.username ?? payload.sub ?? 'unknown',
      employeeNumber: payload.employeeNumber,
      roles: payload.roles ?? [Role.EMPLOYEE],
      functions: payload.functions,
      employeeName: payload.name,
      department: payload.dept,
      company: payload.company,
      claims: payload,
    };
  }
}
