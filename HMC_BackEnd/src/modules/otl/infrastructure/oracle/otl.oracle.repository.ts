import { Injectable, Logger } from '@nestjs/common';
import * as oracledb from 'oracledb';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { BaseOracleRepository } from '@core/database/base.repository';
import { RequestContext } from '@core/http/request-context';
import { SubmitResult } from '@shared/domain/submit-result';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { extractOraCode } from '@shared/constants/error-codes';
import {
  MORE_INFO_ROLE_COLUMN,
  NOTIFICATION_ID_COLUMN,
  RECIPIENT_ROLE_COLUMN,
} from '@shared/constants/oracle-columns';
import {
  OtlDateWindow,
  OtlDegradableRead,
  OtlRepository,
  OtlRow,
  TimecardSubmitCommand,
} from '../../domain/otl.repository';

/** `ORA-04063: view has errors` — XXHMC_SND_OTL_SUMMARY_V is INVALID on EBSDEV (B4). */
const ORA_OBJECT_INVALID = 4063;

/** Every OTL view scoped to a person exposes the FND_USER login as USER_NAME. */
const USER_COLUMN = 'USER_NAME';

/** Declared order of get_absence_details / get_element_name / get_template. */
const DATE_RANGE_PARAMS = ['p_user_name', 'p_start_date', 'p_end_date'] as const;
const TIME_CARD_DETAILS_PARAMS = ['p_notification_id', 'p_user_name'] as const;

const SUBMIT_PARAMS = [
  'p_user_name',
  'p_period',
  'p_confirmation_flag',
  'p_language',
  'p_comments',
  'p_entries',
] as const;
const SUBMIT_SCALAR_OUTS = [
  'p_success_flag',
  'p_error_msg',
  'p_reference_no',
  'p_submitted_date',
  'p_card_status',
] as const;
const APPROVAL_CHAIN = 'p_approval_chain';

/**
 * Local-midnight Date for a `YYYY-MM-DD` bind. node-oracledb writes a
 * DB_TYPE_DATE bind from the Date's LOCAL components, so this reaches Oracle
 * as exactly 00:00 of that day whatever the process time zone; a UTC-midnight
 * Date would arrive as 03:00 under TZ=Asia/Qatar and miss
 * `TRUNC(START_TIME) = :d` as well as absences that start and end on that day.
 */
function oracleDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

const dateBind = (iso: string) => ({ type: oracledb.DB_TYPE_DATE, val: oracleDate(iso) });

/**
 * XXHMC_SND_OTL_PKG + XXHMC_SND_OTL_*_V (contract: EBSDEV 2026-09-29, see
 * .workbench/artifacts/otl-db-findings.md). Three call shapes only:
 *  - the four package reads are TABLE FUNCTIONS, read positionally through
 *    `callRowsOrTableFunction` (DATE/NUMBER binds from the static contract);
 *  - views are plain SELECTs, every person-scoped one filtered by USER_NAME —
 *    TIMECARD_DEATIS_V and SUMMARY_ELE_V are heavy HXC joins that did not
 *    return unfiltered, so they also always carry the month;
 *  - the submit reads its OUTs inside the connection, because its
 *    SYS_REFCURSOR OUT is never OPENed (B9) and must be tolerated.
 * Rows keep their Oracle column names; OtlService shapes them.
 */
@Injectable()
export class OtlOracleRepository extends BaseOracleRepository implements OtlRepository {
  /** Own logger — the base class keeps its instance private. */
  private static readonly log = new Logger(OtlOracleRepository.name);

  constructor(ora: OracleService, schema: OracleSchemaService) {
    super(ora, schema);
  }

  getAbsenceDetails(username: string, startDate: string, endDate: string): Promise<OtlRow[]> {
    return this.readDateRange(
      ORACLE_OBJECTS.OTL_PKG_GET_ABSENCE_DETAILS,
      username,
      startDate,
      endDate,
    );
  }

  getElementDetails(username: string, startDate: string, endDate: string): Promise<OtlRow[]> {
    return this.readDateRange(
      ORACLE_OBJECTS.OTL_PKG_GET_ELEMENT_NAME,
      username,
      startDate,
      endDate,
    );
  }

  getTemplate(username: string, startDate: string, endDate: string): Promise<OtlRow[]> {
    return this.readDateRange(ORACLE_OBJECTS.OTL_PKG_GET_TEMPLATE, username, startDate, endDate);
  }

  /**
   * The function resolves the notification's HXCEMP item key and joins it to
   * the timecard of `p_user_name`, so that parameter is the timecard OWNER.
   * A notification that is not HXCEMP yields no rows, not an error.
   */
  getTimecardNotificationDetails(notificationId: string, requestor: string): Promise<OtlRow[]> {
    return this.callRowsOrTableFunction<OtlRow>(
      ORACLE_OBJECTS.OTL_PKG_GET_TIME_CARD_DETAILS,
      TIME_CARD_DETAILS_PARAMS,
      { p_notification_id: notificationId, p_user_name: requestor.toUpperCase() },
    );
  }

  /** Same role predicate as WorklistOracleRepository.getWorklistSummary (the documented worklist SQL). */
  async isWorklistRecipient(notificationId: string, username: string): Promise<boolean> {
    const rows = await this.query<OtlRow>(
      `SELECT ${NOTIFICATION_ID_COLUMN} FROM ${ORACLE_OBJECTS.WORKLISTS_V}
        WHERE ${NOTIFICATION_ID_COLUMN} = :id
          AND ((${RECIPIENT_ROLE_COLUMN} = :u AND ${MORE_INFO_ROLE_COLUMN} IS NULL)
                OR ${MORE_INFO_ROLE_COLUMN} = :u)`,
      { id: notificationId, u: username.toUpperCase() },
    );
    return rows.length > 0;
  }

  /** Static 4-row catalog — display only; the picker is get_element_name. */
  getElements(): Promise<OtlRow[]> {
    return this.query<OtlRow>(
      `SELECT ELEMENT_TYPE_ID, ELEMENT_NAME FROM ${ORACLE_OBJECTS.OTL_ELEMENT_V} ORDER BY ELEMENT_NAME`,
    );
  }

  /**
   * One row per timecard. The view is INVALID until Oracle fixes B4, so
   * ORA-04063 degrades to `available: false` (logged like a schema mismatch)
   * instead of failing the request.
   */
  async getSummary(username: string, window?: OtlDateWindow): Promise<OtlDegradableRead> {
    const binds: oracledb.BindParameters = { p_user_name: username.toUpperCase() };
    let sql = `SELECT * FROM ${ORACLE_OBJECTS.OTL_SUMMARY_V} WHERE ${USER_COLUMN} = :p_user_name`;
    if (window) {
      sql += ' AND TRUNC(START_TIME) BETWEEN :p_from AND :p_to';
      binds.p_from = dateBind(window.from);
      binds.p_to = dateBind(window.to);
    }
    try {
      return { rows: await this.query<OtlRow>(sql, binds), available: true };
    } catch (err) {
      if (extractOraCode((err as Error)?.message) !== ORA_OBJECT_INVALID) throw err;
      const requestId = RequestContext.get()?.correlationId ?? '-';
      OtlOracleRepository.log.warn(
        `[SCHEMA_MISMATCH] requestId=${requestId} repository=${OtlOracleRepository.name} ` +
          `object=${ORACLE_OBJECTS.OTL_SUMMARY_V} ORA-04063 (view INVALID, Oracle bug B4) — ` +
          'degrading to an empty result instead of failing the request.',
      );
      return { rows: [], available: false };
    }
  }

  getSummaryByElement(username: string, periodStart: string): Promise<OtlRow[]> {
    return this.readUserMonth(ORACLE_OBJECTS.OTL_SUMMARY_ELE_V, username, periodStart);
  }

  getPeriods(username: string, year?: number): Promise<OtlRow[]> {
    const binds: oracledb.BindParameters = { p_user_name: username.toUpperCase() };
    let sql = `SELECT * FROM ${ORACLE_OBJECTS.OTL_EMP_TIME_PERIOD_V} WHERE ${USER_COLUMN} = :p_user_name`;
    if (year !== undefined) {
      sql += ' AND EXTRACT(YEAR FROM START_DATE) = :p_year';
      binds.p_year = year;
    }
    return this.query<OtlRow>(`${sql} ORDER BY START_DATE DESC`, binds);
  }

  getDetails(username: string, periodStart: string): Promise<OtlRow[]> {
    return this.readUserMonth(ORACLE_OBJECTS.OTL_TIMECARD_DEATIS_V, username, periodStart);
  }

  getFacilities(): Promise<OtlRow[]> {
    return this.query<OtlRow>(
      `SELECT FACILITY_CODE, DESCRIPTION, FACILITY FROM ${ORACLE_OBJECTS.OTL_FACILITY_V}
        ORDER BY FACILITY_CODE`,
    );
  }

  getCostCenters(facilityCode: string): Promise<OtlRow[]> {
    return this.query<OtlRow>(
      `SELECT FACILITY_CODE, COST_CENTER_CODE, COST_CENTER_DESCRIPTION, COST_CENTER
         FROM ${ORACLE_OBJECTS.OTL_COST_CENTER_V}
        WHERE FACILITY_CODE = :p_facility_code
        ORDER BY COST_CENTER_CODE`,
      { p_facility_code: facilityCode },
    );
  }

  /**
   * Binds come from the static contract (6 IN incl. the CLOB, 6 OUT incl. the
   * DATE and the REF CURSOR). `callMultiCursorProc` fetches the cursor before
   * the connection is released and treats the never-opened one as `[]`.
   * Oracle answers `S` or `E`; `toSubmitResult` maps everything but S/Y/0 to
   * `N`, so `E` reaches the client as the usual Sanaad `N`.
   */
  async submitTimecard(cmd: TimecardSubmitCommand): Promise<SubmitResult> {
    const { cursors, scalars } = await this.callMultiCursorProc(
      ORACLE_OBJECTS.TIMECARD_SUBMIT_PR,
      SUBMIT_PARAMS,
      {
        p_user_name: cmd.username,
        p_period: cmd.period,
        p_confirmation_flag: cmd.confirmationFlag,
        p_language: cmd.language,
        p_comments: cmd.comments ?? null,
        p_entries: { type: oracledb.DB_TYPE_CLOB, val: cmd.entries },
      },
      [APPROVAL_CHAIN],
      SUBMIT_SCALAR_OUTS,
    );
    const submitted = scalars.p_submitted_date;
    return {
      ...this.toSubmitResult(scalars),
      result: {
        referenceNo: scalars.p_reference_no ?? null,
        submittedDate: submitted instanceof Date ? submitted.toISOString() : (submitted ?? null),
        cardStatus: scalars.p_card_status ?? null,
        approvalChain: cursors[APPROVAL_CHAIN] ?? [],
      },
    };
  }

  private readDateRange(
    object: string,
    username: string,
    startDate: string,
    endDate: string,
  ): Promise<OtlRow[]> {
    return this.callRowsOrTableFunction<OtlRow>(object, DATE_RANGE_PARAMS, {
      p_user_name: username.toUpperCase(),
      p_start_date: oracleDate(startDate),
      p_end_date: oracleDate(endDate),
    });
  }

  /** USER_NAME + month filter — the only way the heavy HXC views may be read. */
  private readUserMonth(object: string, username: string, periodStart: string): Promise<OtlRow[]> {
    return this.query<OtlRow>(
      `SELECT * FROM ${object} WHERE ${USER_COLUMN} = :p_user_name AND TRUNC(START_TIME) = :p_start_date`,
      { p_user_name: username.toUpperCase(), p_start_date: dateBind(periodStart) },
    );
  }
}
