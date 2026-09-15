import { Injectable, Logger } from '@nestjs/common';
import { OracleService } from '@core/database/oracle.service';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { EmployeeIdentity } from '../../domain/auth-identity';
import {
  LoginEmploymentDetails,
  LoginEmploymentPort,
} from '../../domain/ports/login-employment.port';

interface Labels {
  english?: string;
  arabic?: string;
}

@Injectable()
export class OracleLoginEmploymentRepository implements LoginEmploymentPort {
  private readonly logger = new Logger(OracleLoginEmploymentRepository.name);

  constructor(private readonly ora: OracleService) {}

  async resolve(identity: EmployeeIdentity): Promise<LoginEmploymentDetails> {
    const [organization, job] = await Promise.all([
      this.readLabels(
        ORACLE_OBJECTS.ORG_DETAILS_V,
        'ORGANIZATION_ID',
        ['ORGANIZATION_NAME', 'ORGANIZATION_NAME_AR'],
        identity.facilityId,
        identity.facility,
      ),
      this.readLabels(
        ORACLE_OBJECTS.JOB_DETAILS_V,
        'JOB_ID',
        ['JOB_TITLE', 'JOB_TITLE_AR'],
        identity.jobId,
        identity.jobName,
      ),
    ]);
    return {
      organizationName: organization.english,
      organizationNameAr: organization.arabic,
      jobTitle: job.english,
      jobTitleAr: job.arabic,
    };
  }

  private async readLabels(
    view: string,
    keyColumn: string,
    columns: readonly [string, string],
    id: string | undefined,
    fallback: string | undefined,
  ): Promise<Labels> {
    const defaults = { english: fallback, arabic: fallback };
    const key = id?.trim();
    if (!key || !/^\d+$/.test(key) || !Number.isSafeInteger(Number(key))) return defaults;
    if (!this.ora.isConfigured()) return defaults;

    try {
      const [row] = await this.ora.query<Record<string, unknown>>(
        `SELECT ${columns.join(', ')} FROM ${view} WHERE ${keyColumn} = :id AND ROWNUM <= 1`,
        { id: Number(key) },
      );
      return {
        english: text(row?.[columns[0]]) ?? fallback,
        arabic: text(row?.[columns[1]]) ?? fallback,
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
