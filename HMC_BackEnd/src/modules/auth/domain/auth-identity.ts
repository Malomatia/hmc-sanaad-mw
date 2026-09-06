/**
 * Auth domain types (framework-free). Derived from the "Sanaad Mobile
 * Application — User Authentication & Access Control API Framework" v1.0.0.
 * See Docs Project/ (auth framework) and Docs_Ai/Domains (Auth).
 */

export type YesNo = 'Yes' | 'No';

/**
 * Function-access status codes returned in the login `functionaccesslist`.
 * Drives mobile UI (enable/disable/coming-soon); the backend still enforces
 * access via FunctionAccessGuard.
 */
export enum FunctionStatus {
  DISABLED = '0',
  ENABLED = '1',
  COMING_SOON = '2',
}

export interface FunctionAccess {
  functionname: string;
  functioncode: string;
  remarks?: string;
  status: FunctionStatus;
}

/**
 * Employee identity resolved from LDAP/HR during User-Validate (API-2) and
 * Login (API-5). `roles` are plain strings here to keep the domain decoupled
 * from the core Role enum; the application layer maps them.
 */
export interface EmployeeIdentity {
  username: string;
  employeeNumber?: string;
  employeeName?: string;
  employeeNameAr?: string;
  department?: string;
  company?: string;
  jobName?: string;
  /** Corporate email — the OTP fallback channel when there is no mobile. */
  email?: string;
  phoneNumber?: string;
  /** Whether the account is a valid employee eligible to use Sanaad. */
  isEmployee: boolean;
  /** First-time user (no MPIN yet) vs existing user. */
  isNewUser: boolean;
  roles?: string[];
}
