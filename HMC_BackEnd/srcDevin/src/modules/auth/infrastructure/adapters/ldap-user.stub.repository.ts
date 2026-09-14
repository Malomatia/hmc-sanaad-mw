import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  AuthenticateUserQuery,
  LdapUserPort,
  ValidateUserQuery,
} from '../../domain/ports/ldap-user.port';
import { EmployeeIdentity } from '../../domain/auth-identity';

/**
 * Stub LDAP adapter. Throws 501; kept for reference/tests. The module now binds
 * the real LdapUserRepository. In non-production the OnboardingService
 * short-circuits before reaching any adapter (dev bypass).
 */
@Injectable()
export class LdapUserStubRepository implements LdapUserPort {
  validate(_query: ValidateUserQuery): Promise<EmployeeIdentity> {
    throw new NotImplementedException(
      'LDAP user validation is not wired yet — provide the LDAP endpoint/spec. [TODO(spec) API-2]',
    );
  }

  authenticate(_query: AuthenticateUserQuery): Promise<EmployeeIdentity> {
    throw new NotImplementedException(
      'LDAP authentication is not wired yet — provide the LDAP endpoint/spec. [TODO(spec) API-2]',
    );
  }
}
