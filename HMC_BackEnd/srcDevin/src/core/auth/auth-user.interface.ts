/**
 * Identity extracted from the bearer token. Roles are inferred from the
 * approval/supervisor flows in the mapping (confirm against the real model).
 * See Docs_Ai/Domains/README.md (Auth) — login flow is out-of-band.
 */
export enum Role {
  EMPLOYEE = 'EMPLOYEE',
  SUPERVISOR = 'SUPERVISOR',
  APPROVER = 'APPROVER',
}

export interface AuthenticatedUser {
  username: string;
  employeeNumber?: string;
  roles: Role[];
  /** Enabled function/module codes from the login functionaccesslist (API-5). */
  functions?: string[];
  employeeName?: string;
  department?: string;
  company?: string;
  claims?: Record<string, unknown>;
}

/** Permissive identity used only when AUTH_DISABLED=true (local dev). */
export const DEV_USER: AuthenticatedUser = {
  username: 'AIBRAHIM39',
  employeeNumber: '037400',
  roles: [Role.EMPLOYEE, Role.SUPERVISOR, Role.APPROVER],
  functions: ['PYSRS', 'LEAVE', 'LETTER', 'SDCAPT'],
};
