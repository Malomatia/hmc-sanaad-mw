import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@core/auth/auth-user.interface';
import { MotcSmsDbService } from '@core/database/motc-sms-db.service';
import { MotcSmsConfig } from '@core/config/configuration';
import {
  AuthenticateUserQuery,
  LdapUserPort,
  ValidateUserQuery,
} from '../../domain/ports/ldap-user.port';
import { EmployeeIdentity } from '../../domain/auth-identity';

/**
 * Users-DB directory adapter (AUTH_DIRECTORY=usersdb) — resolves the pre-login
 * identity from the live-employee master view `HMC_SND_LIV_EMP_MASTER_VW` on
 * the MOTC_SMS database (client request 2026-09-03; previously the legacy
 * `HMC_Sanad_DeviceRegn_tbl` device registration was the only check):
 *
 *  - The username is looked up by the view's `UserName` column. A user absent
 *    from the view is NOT a live employee — `isEmployee: false`, which makes
 *    /auth/initiate answer "Invalid employee id received.".
 *  - The view carries the identity used downstream: EMPLOYEE_NUMBER,
 *    EMPLOYEE_NAME and MOBILE_NUMBER (the OTP SMS destination). Columns are
 *    picked tolerantly by candidate name; MOBILE_NUMBER can be NULL, in which
 *    case the OTP port rejects with "No registered phone number".
 *  - `isNewUser` here is provisional — OnboardingService recomputes it from
 *    the MPIN store (an MPIN on this device = existing user).
 *  - `authenticate` throws 501 like the Entra adapter (the mobile credential
 *    is OTP + MPIN, never a password).
 */
@Injectable()
export class MssqlUserRepository implements LdapUserPort {
  private readonly logger = new Logger(MssqlUserRepository.name);
  private readonly view: string;

  private static readonly PHONE_COLUMNS = [
    'mobile_number',
    'mobilenumber',
    'mobileno',
    'mobile',
    'phone_number',
    'phonenumber',
    'phoneno',
    'phone',
  ];
  private static readonly NAME_COLUMNS = [
    'employee_name',
    'employeename',
    'empname',
    'fullname',
    'displayname',
  ];
  private static readonly EMPNO_COLUMNS = [
    'employee_number',
    'employeenumber',
    'empno',
    'empnum',
    'staffno',
    'employeeid',
  ];
  private static readonly EMAIL_COLUMNS = [
    'email_address',
    'emailaddress',
    'emailid',
    'email',
    'mailid',
    'mail',
  ];

  constructor(
    private readonly db: MotcSmsDbService,
    config: ConfigService,
  ) {
    this.view = config.getOrThrow<MotcSmsConfig>('motcSms').employeeMasterView;
    // Config-controlled (never user input) but interpolated into SQL as an
    // identifier, so keep it to identifier characters (same rule as the
    // MOTC push table name).
    if (!/^[A-Za-z0-9_.[\]]+$/.test(this.view)) {
      throw new Error(
        `Invalid MOTC_SMS_EMPLOYEE_MASTER_VIEW "${this.view}" — not a SQL identifier.`,
      );
    }
  }

  async validate(query: ValidateUserQuery): Promise<EmployeeIdentity> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT TOP 1 * FROM ${this.view} WHERE UserName = @username`,
      { username: query.username },
    );
    const row = rows[0];
    if (!row) {
      this.logger.warn(
        `No ${this.view} row for "${query.username}" — not a live employee, refusing.`,
      );
      return {
        username: query.username,
        employeeName: query.username,
        isEmployee: false,
        isNewUser: true,
        roles: [],
      };
    }

    return {
      username: query.username,
      phoneNumber: pick(row, MssqlUserRepository.PHONE_COLUMNS),
      email: pick(row, MssqlUserRepository.EMAIL_COLUMNS),
      employeeNumber: pick(row, MssqlUserRepository.EMPNO_COLUMNS),
      employeeName: pick(row, MssqlUserRepository.NAME_COLUMNS) ?? query.username,
      department: pick(row, ['department_desc', 'department']),
      jobName: pick(row, ['job_name', 'jobname']),
      isEmployee: true,
      isNewUser: true,
      roles: [Role.EMPLOYEE],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  authenticate(_query: AuthenticateUserQuery): Promise<EmployeeIdentity> {
    throw new NotImplementedException(
      'Password authentication is not part of the Users-DB journey — the mobile credential is OTP + MPIN.',
    );
  }
}

/** First non-empty value among the candidate columns (case-insensitive). */
function pick(row: Record<string, unknown>, candidates: string[]): string | undefined {
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const key = keys.find((k) => k.toLowerCase() === candidate);
    if (!key) continue;
    const value = row[key];
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return undefined;
}
