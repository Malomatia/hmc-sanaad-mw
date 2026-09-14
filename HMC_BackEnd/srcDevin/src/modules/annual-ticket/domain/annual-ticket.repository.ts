import { Lang } from '@shared/domain/lang';
import { SubmitResult } from '@shared/domain/submit-result';

export interface TicketRequestCommand {
  username: string;
  lang: Lang;
  fields: Record<string, unknown>;
}

/**
 * Inputs of the cancellation form (op 72). The three views are PERSON-scoped
 * (`PERSON_ID`), not username-scoped like most of the other LOVs.
 */
export interface TicketCancelOptions {
  /** Cancellable tickets — `ANNUAL_LEAVE_PASS_TKT_VALUE` feeds `p_annual_tkt`. */
  tickets: Record<string, unknown>[];
  /** How the ticket was taken (Cash | Voucher) — feeds `p_ticket_as`. */
  takenAs: Record<string, unknown>[];
  /** Repayment methods (e.g. Payroll Deduction) — feeds `p_repayment_method`. */
  repaymentMethods: Record<string, unknown>[];
}

/** Port: submit annual-ticket request (op 67) + cancel a ticket (op 72). Master (66) via Lookups. */
export interface TicketRepository {
  apply(cmd: TicketRequestCommand): Promise<SubmitResult>;
  cancel(cmd: TicketRequestCommand): Promise<SubmitResult>;
  cancelOptions(personId: string): Promise<TicketCancelOptions>;
}

export const TICKET_REPOSITORY = Symbol('TICKET_REPOSITORY');
