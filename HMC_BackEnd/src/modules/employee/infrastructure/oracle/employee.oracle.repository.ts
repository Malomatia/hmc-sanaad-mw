import { Injectable } from '@nestjs/common';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { BaseOracleRepository } from '@core/database/base.repository';
import { Lang } from '@shared/domain/lang';
import { SubmitResult } from '@shared/domain/submit-result';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { USERNAME_KEY_CANDIDATES } from '@shared/constants/oracle-columns';

/**
 * SUPERVISOR_PR input params. The confirmed signature is
 * (p_user_name, p_new_supervisor, p_reason, p_file_nameN/p_attachmentN[BLOB],
 * p_success_flag, p_error_msg, p_error_msg_ar) — there is NO p_language, and the
 * attachments are BLOB. Sending p_language raised PLS-00306.
 */
const SUPERVISOR_PR_PARAMS = [
  'p_user_name',
  'p_new_supervisor',
  'p_reason',
  ...BaseOracleRepository.attachmentParams(),
] as const;

import {
  EmploymentDetails,
  EmploymentInfo,
  PerformanceRecord,
  SupervisorView,
} from '../../domain/entities/employment';
import {
  EmploymentRepository,
  SupervisorRepository,
  SupervisorUpdateCommand,
} from '../../domain/employee.repository';
import { EmployeeMapper } from './employee.mapper';

/** Employment reads from EMPLOYMENT_DETAILS_V / PERFORMANCE_V (ops 3, 7, 8). */
@Injectable()
export class EmploymentOracleRepository
  extends BaseOracleRepository
  implements EmploymentRepository
{
  constructor(ora: OracleService, schema: OracleSchemaService) {
    super(ora, schema);
  }

  async getEmployment(username: string, _lang: Lang): Promise<EmploymentInfo> {
    // op 3 is keyed by USER_NAME (client request 2026-08-24) and aggregates
    // three views: the EMPLOYMENT_DETAILS_V record plus the SALARY_V and
    // EMPLOYMENT_V histories. The key column is resolved per view from the
    // data dictionary; a view without a username column degrades to empty
    // (SCHEMA_MISMATCH warning) instead of failing the whole response.
    const [detailRows, salaryRows, assignmentRows] = await Promise.all([
      this.readByResolvedKey(ORACLE_OBJECTS.EMPLOYMENT_DETAILS_V, username, USERNAME_KEY_CANDIDATES),
      this.readByResolvedKey(ORACLE_OBJECTS.SALARY_V, username, USERNAME_KEY_CANDIDATES),
      this.readByResolvedKey(ORACLE_OBJECTS.EMPLOYMENT_V, username, USERNAME_KEY_CANDIDATES),
    ]);
    return {
      details: EmployeeMapper.toEmployment(detailRows[0]),
      salary: salaryRows.map((r) => EmployeeMapper.toSalary(r)),
      assignments: assignmentRows.map((r) => EmployeeMapper.toAssignment(r)),
    };
  }

  async getBasic(employeeNumber: string, _lang: Lang): Promise<EmploymentDetails | undefined> {
    const rows = await this.readByEmployee(ORACLE_OBJECTS.EMPLOYMENT_DETAILS_V, employeeNumber);
    return EmployeeMapper.toEmployment(rows[0]);
  }

  async getPerformance(username: string, _lang: Lang): Promise<PerformanceRecord[]> {
    // PERFORMANCE_V is keyed by the caller's login; resolve the real column name
    // from the data dictionary (hard-coded `username` raised ORA-00904).
    const rows = await this.readByResolvedKey(
      ORACLE_OBJECTS.PERFORMANCE_V,
      username,
      USERNAME_KEY_CANDIDATES,
    );
    return rows.map((r) => EmployeeMapper.toPerformance(r));
  }
}

/** Supervisor view/update (ops 35, 36). SUPERVISOR_PR bind not captured → notImplemented. */
@Injectable()
export class SupervisorOracleRepository
  extends BaseOracleRepository
  implements SupervisorRepository
{
  constructor(ora: OracleService, schema: OracleSchemaService) {
    super(ora, schema);
  }

  getSupervisorViews(
    username: string,
    _lang: Lang,
    searchKeyWord?: string,
  ): Promise<SupervisorView[]> {
    // The original XXHMC_SND_SUPERVISOR_VIEW was a FUNCTION —
    // `FUNCTION(p_user_name IN VARCHAR2, p_limit_txt VARCHAR2) RETURN
    // xxhmc_snd_emp_dets_nt` — queried with SELECT ... FROM TABLE(fn(...)).
    // XXHMC_SND_DELEGATE_EMP_V is a view and must be selected directly.
    // It lists other employees, excluding the request username via USERNAME.
    // The view takes no function arguments. Keep the 2000-row cap:
    // the original lookup returned 31,000+ rows in one call on staging.
    // `searchKeyWord` filters GLOBAL_NAME Oracle-side, BEFORE that cap, so a
    // search sees the whole employee list rather than the first 2000 rows.
    const binds: Record<string, string | number> = {
      username: username.toUpperCase(),
      maxRows: 2000,
    };
    const conditions: string[] = ['UPPER(USER_NAME) != :username'];
    const search = searchKeyWord?.trim();
    if (search) {
      binds.filterValue = `%${search.toUpperCase()}%`;
      conditions.push('UPPER(GLOBAL_NAME) LIKE :filterValue');
    }
    conditions.push('ROWNUM <= :maxRows');
    return this.query<SupervisorView>(
      `SELECT * FROM ${ORACLE_OBJECTS.DELEGATE_EMP_V} WHERE ${conditions.join(' AND ')}`,
      binds,
    );
  }

  async updateSupervisor(cmd: SupervisorUpdateCommand): Promise<SubmitResult> {
    // SUPERVISOR_PR takes no p_language; its OUT contract is p_success_flag /
    // p_error_msg / p_error_msg_ar (used for the fallback when the dictionary is
    // unreadable — the dictionary path derives the OUT binds from the signature).
    const values = { ...cmd.fields, p_user_name: cmd.username };
    return this.callSubmitProc(
      ORACLE_OBJECTS.SUPERVISOR_PR,
      SUPERVISOR_PR_PARAMS,
      values,
      this.successFlagOutBinds(),
    );
  }
}
