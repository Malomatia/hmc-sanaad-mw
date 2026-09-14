import { Injectable } from '@nestjs/common';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { BaseOracleRepository } from '@core/database/base.repository';
import { SubmitResult } from '@shared/domain/submit-result';
import { toOracleLanguage } from '@shared/domain/lang';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { PERSON_ID_COLUMN } from '@shared/constants/oracle-columns';
import {
  TicketCancelOptions,
  TicketRepository,
  TicketRequestCommand,
} from '../../domain/annual-ticket.repository';

/** TICKET_REQ_PR input params (Sanaad spec — Submit_Annual_Ticket request template). */
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
  'p_language',
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

/** op 67 — Submit_Annual_Ticket (TICKET_REQ_PR) · op 72 — cancel (CANCEL_TKT_PR). */
@Injectable()
export class TicketOracleRepository extends BaseOracleRepository implements TicketRepository {
  constructor(ora: OracleService, schema: OracleSchemaService) {
    super(ora, schema);
  }

  async apply(cmd: TicketRequestCommand): Promise<SubmitResult> {
    return this.callSubmitProc(ORACLE_OBJECTS.TICKET_REQ_PR, TICKET_REQ_PARAMS, {
      ...cmd.fields,
      p_language: toOracleLanguage(cmd.lang),
      p_user_name: cmd.username,
    });
  }

  async cancel(cmd: TicketRequestCommand): Promise<SubmitResult> {
    return this.callSubmitProc(ORACLE_OBJECTS.CANCEL_TKT_PR, TICKET_CANCEL_PARAMS, {
      ...cmd.fields,
      p_user_name: cmd.username,
    });
  }

  /** The three cancellation LOVs in one round trip; all keyed by PERSON_ID. */
  async cancelOptions(personId: string): Promise<TicketCancelOptions> {
    const [tickets, takenAs, repaymentMethods] = await Promise.all([
      this.readByPerson(ORACLE_OBJECTS.CANCEL_TICKETS_V, personId),
      this.readByPerson(ORACLE_OBJECTS.CANCEL_TAKENAS_V, personId),
      this.readByPerson(ORACLE_OBJECTS.CANCEL_REPAYMENT_METHODS_V, personId),
    ]);
    return { tickets, takenAs, repaymentMethods };
  }

  private readByPerson(object: string, personId: string): Promise<Record<string, unknown>[]> {
    return this.query(`SELECT * FROM ${object} WHERE ${PERSON_ID_COLUMN} = :p`, { p: personId });
  }
}
