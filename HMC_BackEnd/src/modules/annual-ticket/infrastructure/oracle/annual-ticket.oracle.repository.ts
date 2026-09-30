import { Injectable, Logger } from '@nestjs/common';
import * as oracledb from 'oracledb';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { BaseOracleRepository } from '@core/database/base.repository';
import { SubmitResult } from '@shared/domain/submit-result';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { PERSON_ID_COLUMN, USERNAME_KEY_CANDIDATES } from '@shared/constants/oracle-columns';
import {
  TicketCancelOptionRows,
  TicketEligibility,
  TicketRepository,
  TicketRequestCommand,
} from '../../domain/annual-ticket.repository';

/** TICKET_REQ_PR — confirmed declaration 2026-09-14: 32 IN + 3 OUT, no p_language. */
const TICKET_REQ_PARAMS = [
  'p_user_name',
  'p_request_for',
  'p_employee',
  'p_passenger1',
  'p_passenger2',
  'p_passenger3',
  'p_passenger4',
  'p_request_type',
  'p_contractual_year',
  'p_traveling_dest',
  'p_travel_class',
  'p_comments',
  ...BaseOracleRepository.attachmentParams(),
] as const;

/**
 * CANCEL_TKT_PR input params, read from the data dictionary (there is no
 * `p_language` on this one). The procedure maps them onto the
 * `HMC_HR_ANNUAL_PASSAGE_CANCEL` flexfield: `p_annual_tkt` → segment1,
 * `p_reason` → segment2, `p_ticket_as` → segment3, `p_repayment_method` →
 * segment4, `p_comments` → segment5, `p_voucher_ref` → segment7,
 * `p_contractual_year` → segment10.
 */
const TICKET_CANCEL_PARAMS = [
  'p_user_name',
  'p_annual_tkt',
  'p_contractual_year',
  'p_reason',
  'p_ticket_as',
  'p_repayment_method',
  'p_comments',
  'p_voucher_ref',
  ...BaseOracleRepository.attachmentParams(),
] as const;

/**
 * op 66 — master (TICKET_MASTER + ANNUAL_TICKT_LOV) · op 67 — Submit_Annual_Ticket
 * (TICKET_REQ_PR) · op 72 — cancel (CANCEL_TKT_PR).
 */
@Injectable()
export class TicketOracleRepository extends BaseOracleRepository implements TicketRepository {
  private readonly log = new Logger(TicketOracleRepository.name);

  constructor(ora: OracleService, schema: OracleSchemaService) {
    super(ora, schema);
  }

  async apply(cmd: TicketRequestCommand): Promise<SubmitResult> {
    return this.callSubmitProc(ORACLE_OBJECTS.TICKET_REQ_PR, TICKET_REQ_PARAMS, {
      ...cmd.fields,
      p_user_name: cmd.username,
    });
  }

  async cancel(cmd: TicketRequestCommand): Promise<SubmitResult> {
    return this.callSubmitProc(ORACLE_OBJECTS.CANCEL_TKT_PR, TICKET_CANCEL_PARAMS, {
      ...cmd.fields,
      p_user_name: cmd.username,
    });
  }

  /**
   * The caller's PERSON_ID from EMPLOYMENT_DETAILS_V, keyed by the JWT
   * username. The cancellation views expose no USER_NAME column, so this is
   * the only way to scope them to the caller. Null when the user has no
   * employment row (or the row carries no PERSON_ID).
   */
  async resolvePersonId(username: string): Promise<string | null> {
    const rows = await this.readByResolvedKey(
      ORACLE_OBJECTS.EMPLOYMENT_DETAILS_V,
      username,
      USERNAME_KEY_CANDIDATES,
    );
    const personId = rows
      .map((row) => String(row.PERSON_ID ?? '').trim())
      .find((value) => /^\d+$/.test(value));
    return personId ?? null;
  }

  /**
   * op 66 — the caller's rows of XXHMC_SND_TICKET_MASTER (a UNION of the
   * passenger, contract-year, request-for, destination and ticket-class
   * views). Always filtered on USER_NAME: the unfiltered view exceeded the
   * request timeout (HTTP 408). A schema mismatch degrades to [] with a
   * SCHEMA_MISMATCH warning (`readByResolvedKey`).
   */
  getMaster(username: string): Promise<Record<string, unknown>[]> {
    return this.readByResolvedKey(ORACLE_OBJECTS.TICKET_MASTER, username, USERNAME_KEY_CANDIDATES);
  }

  /**
   * op 66 — the caller's annual-ticket eligibility flag. ANNUAL_TICKT_LOV holds
   * one row per user (`Yes`/`No` from
   * `xxhmc_hr_sit_leaveadv_pkg_dp.get_travelling_days_default`). A side read
   * of the master: any failure is logged and answers null, never an error.
   * A value other than Yes/No is also null (with its Arabic twin), so the two
   * fields can never disagree between `lang=en` and `lang=ar`.
   */
  async getEligibility(username: string): Promise<TicketEligibility | null> {
    try {
      const [row] = await this.readByResolvedKey(
        ORACLE_OBJECTS.ANNUAL_TICKT_LOV,
        username,
        USERNAME_KEY_CANDIDATES,
      );
      if (!row) return null;
      const flag = String(row.ANUAL_TKT_DEFAULT ?? '')
        .trim()
        .toLowerCase();
      const eligible = flag === 'yes' ? 'Yes' : flag === 'no' ? 'No' : null;
      const ar = row.ANUAL_TKT_DEFAULT_AR;
      return {
        eligible,
        eligibleAr: eligible && ar !== null && ar !== undefined && ar !== '' ? String(ar) : null,
      };
    } catch (err) {
      this.log.warn(
        `[READ_DEGRADED] object=${ORACLE_OBJECTS.ANNUAL_TICKT_LOV} failed: ${(err as Error).message} — eligible: null`,
      );
      return null;
    }
  }

  /**
   * The three cancellation LOVs in parallel; all keyed by PERSON_ID. The id is
   * the server-resolved one (never a client value) and is bound as a NUMBER
   * against the contract's key column. Raw rows: the join on
   * ANALYSIS_CRITERIA_ID happens in the service.
   */
  async cancelOptions(personId: string): Promise<TicketCancelOptionRows> {
    const id = Number(personId);
    if (!/^\d+$/.test(personId) || !Number.isSafeInteger(id)) {
      return { tickets: [], takenAs: [], repaymentMethods: [] };
    }
    const [tickets, takenAs, repaymentMethods] = await Promise.all([
      this.readByPerson(ORACLE_OBJECTS.CANCEL_TICKETS_V, id),
      this.readByPerson(ORACLE_OBJECTS.CANCEL_TAKENAS_V, id),
      this.readByPerson(ORACLE_OBJECTS.CANCEL_REPAYMENT_METHODS_V, id),
    ]);
    return { tickets, takenAs, repaymentMethods };
  }

  /**
   * Not `readByResolvedKey`: that binds the key as text, and PERSON_ID is a
   * NUMBER column. The key column still comes from the static contract, so a
   * view without a registered PERSON_ID fails closed (503) before any SQL.
   */
  private async readByPerson(object: string, personId: number): Promise<Record<string, unknown>[]> {
    if (!this.schema) {
      throw new Error(
        `${this.constructor.name} must inject OracleSchemaService to read ${object}.`,
      );
    }
    const keyColumn = await this.schema.resolveKeyColumn(object, [PERSON_ID_COLUMN]);
    return this.query(`SELECT * FROM ${object} WHERE ${keyColumn} = :p`, {
      p: { type: oracledb.DB_TYPE_NUMBER, val: personId },
    });
  }
}
