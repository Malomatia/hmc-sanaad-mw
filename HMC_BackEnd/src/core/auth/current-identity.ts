import { UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { CallerIdentity, normalizePersonId } from '@shared/domain/caller-identity';
import { AuthenticatedUser } from './auth-user.interface';

const nonblank = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

export class MissingIdentityClaimException extends UnprocessableEntityException {
  constructor(key: keyof CallerIdentity) {
    super(
      `This session is missing ${key === 'personId' ? 'person_id' : key}; please log in again.`,
    );
  }
}

export function requireCallerClaim(caller: CallerIdentity, key: keyof CallerIdentity): string {
  const value = key === 'personId' ? normalizePersonId(caller[key]) : nonblank(caller[key]);
  if (value !== undefined) return value;
  if (key === 'username') throw new UnauthorizedException('Authenticated username is required.');
  throw new MissingIdentityClaimException(key);
}

export function currentIdentity(user: AuthenticatedUser): AuthenticatedUser & CallerIdentity {
  const claims = user?.claims ?? {};
  const username = nonblank(claims.username);
  if (!username) throw new UnauthorizedException('Authenticated username is required.');
  return {
    ...user,
    username,
    employeeNumber: nonblank(claims.employeeNumber),
    personId: normalizePersonId(claims.person_id),
  };
}

export function requireIdentity(user: AuthenticatedUser, key: keyof CallerIdentity): string {
  return requireCallerClaim(currentIdentity(user), key);
}
