import { Role } from '@core/auth/auth-user.interface';
import { EmployeeIdentity, FunctionAccess, FunctionStatus } from '../domain/auth-identity';

/**
 * Dev-only fallbacks used when auth is explicitly bypassed (AUTH_DISABLED=true),
 * mirroring the repo's existing dev-token philosophy so the full journey can be
 * exercised without LDAP/OTP/MPIN backends. NEVER enable in production.
 */
export const DEV_FUNCTION_ACCESS: FunctionAccess[] = [
  { functionname: 'Payroll SSRS', functioncode: 'PYSRS', remarks: 'Payroll SSRS', status: FunctionStatus.ENABLED },
  { functionname: 'Leave', functioncode: 'LEAVE', remarks: 'Leave', status: FunctionStatus.ENABLED },
  { functionname: 'Letters', functioncode: 'LETTER', remarks: 'Letters', status: FunctionStatus.ENABLED },
  { functionname: 'Staff Clinic Apptmnt', functioncode: 'SDCAPT', remarks: 'Staff Clinic Appointment', status: FunctionStatus.ENABLED },
  { functionname: 'Housing', functioncode: 'HOUSNG', remarks: 'Housing (coming soon)', status: FunctionStatus.COMING_SOON },
];

/**
 * `employeeNumber` is left unset rather than invented: several views key on the
 * real number, and a placeholder like '000000' matches nothing while looking
 * like an answer. Adapters that need it resolve it from the username against
 * the data dictionary instead (see ApprovalsOracleRepository.scopeKeys).
 *
 * Roles are permissive here for the same reason DEV_USER is: AUTH_DISABLED
 * means authorization is off too, and without the approver role the whole
 * approvals journey is unreachable in a dev environment.
 */
export function devIdentity(username: string): EmployeeIdentity {
  return {
    username,
    employeeName: 'Dev User',
    employeeNameAr: 'مستخدم تجريبي',
    department: 'Information Communication and Technology',
    company: 'HMC',
    phoneNumber: '7786XXXX',
    isEmployee: true,
    isNewUser: false,
    roles: [Role.EMPLOYEE, Role.SUPERVISOR, Role.APPROVER],
  };
}
