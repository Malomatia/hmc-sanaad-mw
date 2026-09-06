import { BadRequestException, Injectable } from '@nestjs/common';
import * as oracledb from 'oracledb';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { BaseOracleRepository } from '@core/database/base.repository';
import { SubmitResult } from '@shared/domain/submit-result';
import { toOracleLanguage } from '@shared/domain/lang';
import { parseOracleDate } from '@shared/utils/date.util';
import { col, dateStr, pruneUndefined, str, strAr } from '@shared/utils/mapper.util';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { USERNAME_KEY_CANDIDATES } from '@shared/constants/oracle-columns';
import {
  LeaveApplyCommand,
  LeaveBalance,
  LeaveBalanceQuery,
  LeaveCalcCommand,
  LeaveDuration,
  LeaveListQuery,
  LeaveMutationCommand,
  LeaveRecord,
  LeaveRepository,
  RflLovKind,
} from '../../domain/leave.repository';
import { LeaveApplyBinds } from './leave-apply.binds';

/*
 * The two lists below mirror the declared signatures (ALL_ARGUMENTS, verified
 * 2026-08-27; confirmed by the DB team): `p_leave_type` first, then
 * `p_user_name`, 25 IN params and 3 OUT.
 *
 * Neither procedure declares `p_language` — we used to append it, and it was
 * silently dropped because `callSubmitProc` resolves the real argument list
 * from the data dictionary and binds by name, but the list then misdescribed
 * the contract. Arabic still comes back through `p_error_msg_ar`.
 */

/** HR_LEAV_AMEND_PR — 25 IN + 3 OUT. */
const LEAVE_AMEND_PARAMS = [
  'p_leave_type',
  'p_user_name',
  'p_leave_to_amend',
  'p_new_end_date',
  'p_comments',
  ...BaseOracleRepository.attachmentParams(),
] as const;

/** HR_LEAV_CANCEL_PR — 25 IN + 3 OUT. */
const LEAVE_CANCEL_PARAMS = [
  'p_leave_type',
  'p_user_name',
  'p_leave_to_cancel',
  'p_reason_for_cancel',
  'p_remarks',
  ...BaseOracleRepository.attachmentParams(),
] as const;

/** RET_FRM_LEAV_PR input params (Sanaad spec — ReturnFromLeaveSubmit body). */
const LEAVE_RETURN_PARAMS = [
  'p_user_name',
  'p_leave_details',
  'p_related_leave1',
  'p_related_leave2',
  'p_return_date',
  'p_comments',
  ...BaseOracleRepository.attachmentParams(),
  'p_language',
] as const;

/** LEAVE_BALANCE_PR input params (Sanaad spec — LeaveBalance input). */
const LEAVE_BALANCE_PARAMS = ['p_user_name', 'p_effective_date', 'p_language'] as const;

/**
 * CALC_LEAV_DUR_PR confirmed signature (there is NO p_language, and the OUT
 * contract is p_duration/p_success_flag/p_error_msg/p_error_msg_ar, not
 * p_status/p_message):
 *   XXHMC_SND_CALC_LEAV_DUR_PR(p_user_name, p_absence_type,
 *     p_start_date DATE, p_end_date DATE, p_duration OUT NUMBER,
 *     p_success_flag OUT VARCHAR2, p_error_msg OUT VARCHAR2,
 *     p_error_msg_ar OUT VARCHAR2)
 */
const LEAVE_CALC_PARAMS = ['p_user_name', 'p_absence_type', 'p_start_date', 'p_end_date'] as const;

/**
 * Leave procedures. `apply` (op 10) is implemented via the LeaveApplyBinds
 * builder (Pattern C). Balance/calc/amend/cancel/return proc signatures are not
 * fully captured → notImplemented. Employment context is a direct view read.
 */
@Injectable()
export class LeaveOracleRepository extends BaseOracleRepository implements LeaveRepository {
  constructor(ora: OracleService, schema: OracleSchemaService) {
    super(ora, schema);
  }

  /**
   * op 9 — leave balance. LEAVE_BALANCE_PR takes the user, effective date and
   * language and returns the accrual-plan balances through a REF CURSOR.
   *
   * `p_user_name` is bound to the value EXACTLY as it came from the request
   * (client request 2026-08-30): `?username=` as-is, or the legacy
   * `?person_id=` when that is what the caller sent. No PERSON_ID resolution.
   * (An earlier live test had only succeeded with the numeric PERSON_ID —
   * superseded by this instruction; if the procedure still rejects usernames,
   * the fix belongs in the procedure, not here.)
   */
  async getBalance(query: LeaveBalanceQuery): Promise<LeaveBalance[]> {
    const userName = (query.username ?? query.personId ?? '').trim();
    if (!userName) {
      throw new BadRequestException('username (or the legacy person_id) is required.');
    }
    return this.callRowsProc<LeaveBalance>(
      ORACLE_OBJECTS.LEAVE_BALANCE_PR,
      LEAVE_BALANCE_PARAMS,
      {
        p_user_name: userName,
        p_effective_date: query.effectiveDate,
        p_language: toOracleLanguage(query.lang),
      },
    );
  }

  /**
   * GET /leaves — the user's leave history from ABSENCE_V, optionally filtered
   * by ABSENCE_TYPE (English value). Both language columns are mapped; the
   * ResponseInterceptor collapses the `*Ar` twins per the request's lang.
   *
   * Confirmed live columns (data dictionary): USER_NAME, ABSENCE_TYPE,
   * ABSENCE_TYPE_AR, REASON (the ENGLISH reason — there is no ABSENCE_REASON,
   * that spelling raised ORA-00904), ABSENCE_REASON_AR, ACTUAL_START_DATE,
   * ACTUAL_END_DATE (both VARCHAR2(10) display strings, not DATEs),
   * ABSENCE_DAYS NUMBER(9,4), NOTIFIED_DATE.
   */
  async list(query: LeaveListQuery): Promise<LeaveRecord[]> {
    const binds: { u: string; t?: string } = { u: query.username };
    let sql =
      `SELECT ABSENCE_TYPE, ABSENCE_TYPE_AR, REASON, ABSENCE_REASON_AR,
              ACTUAL_START_DATE, ACTUAL_END_DATE, ABSENCE_DAYS
         FROM ${ORACLE_OBJECTS.ABSENCE_V}
        WHERE USER_NAME = :u`;
    if (query.leaveType) {
      sql += ' AND ABSENCE_TYPE = :t';
      binds.t = query.leaveType;
    }
    const rows = await this.query(sql, binds);
    const records = rows.map((row) => {
      const days = col(row, 'ABSENCE_DAYS');
      return pruneUndefined({
        absenceType: str(row, 'ABSENCE_TYPE'),
        absenceTypeAr: strAr(row, 'ABSENCE_TYPE_AR'),
        absenceReason: str(row, 'REASON'),
        absenceReasonAr: strAr(row, 'ABSENCE_REASON_AR'),
        actualStartDate: dateStr(row, 'ACTUAL_START_DATE'),
        actualEndDate: dateStr(row, 'ACTUAL_END_DATE'),
        absenceDays:
          days == null ? undefined : Number.isFinite(Number(days)) ? Number(days) : String(days),
      }) as LeaveRecord;
    });
    // Newest first. ACTUAL_START_DATE is a VARCHAR2 display string, so an SQL
    // ORDER BY would sort alphabetically (and TO_DATE could ORA-01861 on an
    // unexpected format) — sort here via the tolerant date parser instead;
    // unparseable dates sink to the end.
    const time = (value?: string) => parseOracleDate(value ?? null)?.getTime() ?? 0;
    return records.sort((a, b) => time(b.actualStartDate) - time(a.actualStartDate));
  }

  async apply(cmd: LeaveApplyCommand): Promise<SubmitResult> {
    const binds = LeaveApplyBinds.from(cmd);
    const out = await this.call<Record<string, any>>(
      `BEGIN ${ORACLE_OBJECTS.LEAV_OF_ABSEN_NEW_PR}(\n          ${LeaveApplyBinds.signature}); END;`,
      binds,
    );
    const result = this.toSubmitResult(out);
    const leaveDays = Number(out.p_leave_days);
    return Number.isFinite(leaveDays) ? { ...result, result: { leaveDays } } : result;
  }

  async calculate(cmd: LeaveCalcCommand): Promise<LeaveDuration> {
    const namedArgs = [
      ...LEAVE_CALC_PARAMS.map((p) => `${p} => :${p}`),
      'p_duration => :p_duration',
      'p_success_flag => :p_success_flag',
      'p_error_msg => :p_error_msg',
      'p_error_msg_ar => :p_error_msg_ar',
    ].join(',\n          ');
    const out = await this.call<Record<string, any>>(
      `BEGIN ${ORACLE_OBJECTS.CALC_LEAV_DUR_PR}(\n          ${namedArgs}); END;`,
      {
        p_user_name: cmd.username,
        p_absence_type: cmd.absenceType,
        p_start_date: { type: oracledb.DB_TYPE_DATE, val: parseOracleDate(cmd.startDate) },
        p_end_date: { type: oracledb.DB_TYPE_DATE, val: parseOracleDate(cmd.endDate) },
        p_duration: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        p_success_flag: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 10 },
        p_error_msg: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 4000 },
        p_error_msg_ar: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 4000 },
      },
    );
    const days = Number(out.p_duration);
    return {
      days: Number.isFinite(days) ? days : undefined,
      successFlag: out.p_success_flag,
      errorMessage: out.p_error_msg,
    };
  }

  async amend(cmd: LeaveMutationCommand): Promise<SubmitResult> {
    return this.callSubmitProc(ORACLE_OBJECTS.HR_LEAV_AMEND_PR, LEAVE_AMEND_PARAMS, this.values(cmd));
  }

  async cancel(cmd: LeaveMutationCommand): Promise<SubmitResult> {
    return this.callSubmitProc(ORACLE_OBJECTS.HR_LEAV_CANCEL_PR, LEAVE_CANCEL_PARAMS, this.values(cmd));
  }

  async returnFromLeave(cmd: LeaveMutationCommand): Promise<SubmitResult> {
    const values = this.values(cmd);
    for (const field of ['p_leave_details', 'p_related_leave1', 'p_related_leave2']) {
      const compact = LeaveOracleRepository.compactLeaveRef(values[field]);
      if (compact !== undefined) values[field] = compact;
    }
    return this.callSubmitProc(ORACLE_OBJECTS.RET_FRM_LEAV_PR, LEAVE_RETURN_PARAMS, values);
  }

  /**
   * Rewrite the op 55 LOV's DISPLAY string into the compact form the procedure
   * can actually hold.
   *
   * `RET_FRM_LEAV_PR` copies this value into `lc_segment5`, declared
   * `VARCHAR2(60)` (source line 60, assigned line 196) — but its own LOV
   * returns ~75 characters:
   *
   *   'Casual Leave|Leave Start Date : 19-APR-2026 and Leave End Date : 19-APR-2026'
   *
   * so passing the LOV value verbatim always raised `ORA-06502: character
   * string buffer too small`. The same leave in the compact
   * `Type|start|end` form (36 chars) resolves correctly, so the labels are
   * stripped here instead of asking every client to reformat the value it just
   * read from the LOV. Values already compact, or in any other shape, are left
   * untouched.
   */
  private static compactLeaveRef(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const parts = value.split('|');
    if (parts.length !== 2) return undefined;
    const dates = parts[1].match(/\d{1,2}-[A-Za-z]{3}-\d{4}/g);
    if (!dates || dates.length < 2) return undefined;
    return `${parts[0].trim()}|${dates[0]}|${dates[1]}`;
  }

  /** The return-from-leave LOV view backing each kind (op 56 inputs). */
  private static readonly RFL_LOV_VIEW: Record<RflLovKind, string> = {
    details: ORACLE_OBJECTS.RFL_LEAVE_DET_V,
    related1: ORACLE_OBJECTS.RFL_REL_LEAVE1_V,
    related2: ORACLE_OBJECTS.RFL_REL_LEAVE2_V,
  };

  /**
   * RFL_LEAVE_DET_LOV / RFL_REL_LEAVE1_LOV / RFL_REL_LEAVE2_LOV — raw rows,
   * keeping EVERY column (USER_NAME, LEAVE, ABSENCE_ATTENDANCE_ID): op 56
   * binds the numeric id, which the LovItem mapping would drop.
   *
   * Resolved rather than hard-coded: readByUsername defaults to the column
   * literal `username`, but these views spell it `USER_NAME`, so all three
   * endpoints answered ORA-00904 / HTTP 500 — which left the id unreachable
   * and POST /leave/return impossible to call from a client.
   */
  rflLov(kind: RflLovKind, username: string): Promise<Record<string, unknown>[]> {
    return this.readByResolvedKey(
      LeaveOracleRepository.RFL_LOV_VIEW[kind],
      username,
      USERNAME_KEY_CANDIDATES,
    );
  }

  /**
   * Merge the posted `p_*` body with the enforced caller. No `p_language`:
   * none of the leave procedures declares one (checked across CANCEL, AMEND,
   * RET_FRM_LEAV, LEAV_OF_ABSEN_NEW and LEAVE_BALANCE), so it only produced a
   * bind that was thrown away. The Arabic message arrives in `p_error_msg_ar`.
   */
  private values(cmd: LeaveMutationCommand): Record<string, unknown> {
    return { ...cmd.fields, p_user_name: cmd.username };
  }

  async getEmploymentContext(
    employeeNumber: string,
  ): Promise<Record<string, unknown> | undefined> {
    const rows = await this.readByEmployee(ORACLE_OBJECTS.EMPLOYMENT_DETAILS_V, employeeNumber);
    return rows[0];
  }
}
