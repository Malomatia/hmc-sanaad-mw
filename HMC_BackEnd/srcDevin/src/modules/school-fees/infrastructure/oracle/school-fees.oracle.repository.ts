import { BadRequestException, Injectable } from '@nestjs/common';
import * as oracledb from 'oracledb';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { BaseOracleRepository } from '@core/database/base.repository';
import { SubmitResult } from '@shared/domain/submit-result';
import { parseOracleDate } from '@shared/utils/date.util';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import {
  ChildDetail,
  ChildrenQuery,
  SchoolFeeApplyCommand,
  SchoolFeeRepository,
} from '../../domain/school-fees.repository';

/** SCHOOL_FEE_PR — confirmed 36 IN + 3 OUT, with no language parameter. */
const SCHOOL_FEE_PARAMS = [
  'p_user_name',
  'p_academic_year',
  'p_acd_st_dt',
  'p_acd_end_dt',
  'p_child_name',
  'p_child_date_birth',
  'p_passport_number',
  'p_rp_number',
  'p_school_name',
  'p_educational_stage',
  'p_request_type',
  'p_term',
  'p_amount',
  'p_receipt_number',
  'p_spouse_working',
  'p_comments',
  ...BaseOracleRepository.attachmentParams(),
] as const;

/**
 * CHILD_DETS_VIEW input params. Named like a view but is actually a table
 * function — `FUNCTION XXHMC_SND_CHILD_DETS_VIEW(p_acad_yr_strt_dt, p_user_name)
 * RETURN xxhmc_snd_child_detl_nt` (confirmed by Oracle) — so it takes exactly
 * these two, not the three-parameter `GetSchoolChildListDetails` request shape
 * (`user_name`/`s_date`/`language`) the Sanaad mapping documents; there is no
 * language parameter. The confirmed parameter order drives the positional
 * TABLE(...) call without consulting schema metadata, so a failed lookup
 * cannot change the call into a procedure.
 */
const CHILD_DETS_PARAMS = ['p_acad_yr_strt_dt', 'p_user_name'] as const;

/**
 * op 39 — SCHOOL_FEE_PR submit. op 52 — child details.
 *
 * `CHILD_DETS_VIEW` is named like a view but is a program unit: selecting from it
 * raised `ORA-04044: procedure, function, package, or type is not allowed here`,
 * and calling it as a procedure (`BEGIN object(...); END;`) raised
 * `PLS-00221: is not a procedure or is undefined` — it is a table FUNCTION, so
 * `queryTableFunction` always uses `SELECT * FROM TABLE(fn(...))` without
 * consulting the dictionary. Metadata failures must never switch it to a
 * direct view read or a cursor-returning procedure.
 */
@Injectable()
export class SchoolFeeOracleRepository extends BaseOracleRepository implements SchoolFeeRepository {
  constructor(ora: OracleService, schema: OracleSchemaService) {
    super(ora, schema);
  }

  async apply(cmd: SchoolFeeApplyCommand): Promise<SubmitResult> {
    const rawAmount = cmd.fields.p_amount;
    const amountText = typeof rawAmount === 'string' || typeof rawAmount === 'number'
      ? String(rawAmount).trim()
      : '';
    const amount = Number(amountText);
    if (
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(amountText) ||
      !Number.isFinite(amount) ||
      (Number.isInteger(amount) && !Number.isSafeInteger(amount))
    ) {
      throw new BadRequestException('p_amount must be a valid finite number within the supported range.');
    }

    return this.callDocumentedSubmitProc(
      ORACLE_OBJECTS.SCHOOL_FEE_PR,
      SCHOOL_FEE_PARAMS,
      {
        ...cmd.fields,
        p_user_name: cmd.username,
        p_acd_st_dt: {
          type: oracledb.DB_TYPE_DATE,
          val: parseOracleDate(cmd.fields.p_acd_st_dt),
        },
        p_acd_end_dt: {
          type: oracledb.DB_TYPE_DATE,
          val: parseOracleDate(cmd.fields.p_acd_end_dt),
        },
        p_amount: { type: oracledb.DB_TYPE_NUMBER, val: amount },
      },
      this.stringOutBinds(['p_success_flag', 'p_error_msg', 'p_error_msg_ar']),
    );
  }

  async getChildren(query: ChildrenQuery): Promise<ChildDetail[]> {
    // Bind the confirmed function signature even when schema discovery is unavailable.
    const values = {
      p_acad_yr_strt_dt: query.academicYearStartDate,
      p_user_name: query.employeeNumber.toUpperCase(),
    };
    return this.queryTableFunction<ChildDetail>(
      ORACLE_OBJECTS.CHILD_DETS_VIEW,
      CHILD_DETS_PARAMS.map((param) => values[param]),
    );
  }
}
