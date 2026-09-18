import { UnauthorizedException } from '@nestjs/common';
import { Role } from './auth-user.interface';

export interface SessionClaims extends Record<string, unknown> {
  sub: string;
  username: string;
  deviceImei: string;
  sid: string;
  jti: string;
  typ: 'access' | 'refresh';
  iat: number;
  exp: number;
  employeeNumber?: string;
  enum?: string;
  roles?: Role[];
  functions?: string[];
  name?: string;
  dept?: string;
  company?: string;
}

export function assertSessionClaims(
  payload: unknown,
  type: 'access' | 'refresh',
): asserts payload is SessionClaims {
  const claims = payload as Partial<SessionClaims> | null;
  const fields = ['sub', 'username', 'deviceImei', 'sid', 'jti'] as const;
  if (
    !claims ||
    typeof claims !== 'object' ||
    Array.isArray(claims) ||
    fields.some(
      (key) => typeof claims[key] !== 'string' || !claims[key]!.trim() || claims[key]!.length > 256,
    ) ||
    claims.typ !== type ||
    !Number.isSafeInteger(claims.exp) ||
    !Number.isSafeInteger(claims.iat) ||
    claims.exp! <= Math.floor(Date.now() / 1000) ||
    claims.iat! > Math.floor(Date.now() / 1000) + 30 ||
    claims.exp! <= claims.iat! ||
    ['employeeNumber', 'enum', 'name', 'dept', 'company'].some(
      (key) => claims[key] !== undefined && typeof claims[key] !== 'string',
    ) ||
    ['roles', 'functions'].some(
      (key) =>
        claims[key] !== undefined &&
        (!Array.isArray(claims[key]) ||
          !(claims[key] as unknown[]).every((value) => typeof value === 'string')),
    )
  ) {
    throw new UnauthorizedException('Invalid session token. Please log in again.');
  }
}
