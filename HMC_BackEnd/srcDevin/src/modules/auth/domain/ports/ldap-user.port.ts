import { EmployeeIdentity } from '../auth-identity';

/** Input for identity resolution by directory search (no password). */
export interface ValidateUserQuery {
  username: string;
  imei: string;
  platform?: string;
}

/** Input for Active Directory credential verification (bind as the user). */
export interface AuthenticateUserQuery {
  username: string;
  password: string;
  imei?: string;
  platform?: string;
}

/**
 * Port for the corporate directory (Active Directory / LDAP):
 *  - `validate`     → resolve employee identity by search (no password); used by
 *                     API-2 (dev) and API-5 login identity resolution.
 *  - `authenticate` → verify the user's AD password (bind) and resolve identity;
 *                     used by API-2 onboarding. See the auth framework doc, API-2.
 */
export interface LdapUserPort {
  validate(query: ValidateUserQuery): Promise<EmployeeIdentity>;
  authenticate(query: AuthenticateUserQuery): Promise<EmployeeIdentity>;
}

export const LDAP_USER_PORT = Symbol('LDAP_USER_PORT');
