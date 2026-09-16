import { Injectable, Logger } from '@nestjs/common';
import { OracleService } from '@core/database/oracle.service';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { EmployeeIdentity } from '../../domain/auth-identity';
import {
  LoginEmploymentDetails,
  LoginEmploymentPort,
} from '../../domain/ports/login-employment.port';

@Injectable()
export class OracleLoginEmploymentRepository implements LoginEmploymentPort {
  private readonly logger = new Logger(OracleLoginEmploymentRepository.name);

  constructor(private readonly ora: OracleService) {}

  async resolve(identity: EmployeeIdentity): Promise<LoginEmploymentDetails> {
    const defaults: LoginEmploymentDetails = {
      organizationName: identity.facility,
      organizationNameAr: identity.facility,
      jobTitle: identity.jobName,
      jobTitleAr: identity.jobName,
    };
    const username = text(identity.username)?.toUpperCase();
    if (!username || !this.ora.isConfigured()) return defaults;

    const view = `APPS.${ORACLE_OBJECTS.EMPLOYMENT_DETAILS_V}`;
    try {
      const [row] = await this.ora.query<Record<string, unknown>>(
        "SELECT REGEXP_SUBSTR(DEPARTMENT, '[^.]+$') AS ORG, " +
          "REGEXP_SUBSTR(DEPARTMENT_AR, '^[^.]+') AS ORG_AR, " +
          "REGEXP_SUBSTR(JOB, '[^.]+', 1, 2) AS JOB, " +
          "REGEXP_SUBSTR(JOB_AR, '[^.]+', 1, 2) AS JOB_AR, " +
          `USER_NAME FROM ${view} WHERE USER_NAME = :username AND ROWNUM <= 1`,
        { username },
      );
      return {
        organizationName: text(row?.ORG) ?? defaults.organizationName,
        organizationNameAr: text(row?.ORG_AR) ?? defaults.organizationNameAr,
        jobTitle: text(row?.JOB) ?? defaults.jobTitle,
        jobTitleAr: text(row?.JOB_AR) ?? defaults.jobTitleAr,
      };
    } catch {
      this.logger.warn(`${view} lookup failed; using employee-master fallback.`);
      return defaults;
    }
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}
