import { Lang } from '@shared/domain/lang';
import { SubmitResult } from '@shared/domain/submit-result';

export interface TicketRequestCommand {
  username: string;
  lang: Lang;
  fields: Record<string, unknown>;
}

/**
 * Raw rows of the three cancellation views (op 72), as Oracle returns them.
 * The views are PERSON-scoped (`PERSON_ID`), not username-scoped like most of
 * the other LOVs, so the caller's PERSON_ID is resolved server-side first
 * (`resolvePersonId`). ANALYSIS_CRITERIA_ID is the join key between them.
 */
export interface TicketCancelOptionRows {
  /** XXHMC_SND_CANCEL_TICKETS_V — ANALYSIS_CRITERIA_ID + composite ANNUAL_LEAVE_PASS_TKT_VALUE. */
  tickets: Record<string, unknown>[];
  /** XXHMC_SND_CANCEL_TAKENAS_V — TAKES_AS (Cash | Voucher) per ANALYSIS_CRITERIA_ID. */
  takenAs: Record<string, unknown>[];
  /** XXHMC_SND_CANCEL_REPAYMENT_METHODS_V — FLEX_VALUE / DESCRIPTION per ANALYSIS_CRITERIA_ID. */
  repaymentMethods: Record<string, unknown>[];
}

/** A picker value: `value` is what Oracle expects back, `label`/`labelAr` is what the user sees. */
export interface TicketOption {
  value: string | null;
  label: string | null;
  labelAr: string | null;
}

/**
 * One cancellable ticket (op 72), joined server-side on ANALYSIS_CRITERIA_ID.
 * The client sends back only `analysisCriteriaId`; every CANCEL_TKT_PR value
 * is resolved from these views again at submit time.
 */
export interface TicketCancellable {
  analysisCriteriaId: string;
  /** ANNUAL_LEAVE_PASS_TKT_VALUE verbatim — display text; `p_annual_tkt` carries `analysisCriteriaId`. */
  value: string;
  requestFor: string | null;
  employeeName: string | null;
  passengers: string[];
  /** Composite segment 6 (becomes `p_contractual_year`). */
  contractualYear: string | null;
  /** TAKENAS_V.TAKES_AS for this ticket, else composite segment 7 (becomes `p_ticket_as`). */
  takenAs: string | null;
  takenAsAr: string | null;
  amount: string | null;
  /** REPAYMENT_METHODS_V rows of this ticket; `value` becomes `p_repayment_method`. */
  repaymentMethods: TicketRepaymentMethod[];
}

/** A ticket's repayment method: `label` is the method itself (FLEX_VALUE), `appliesTo` its DESCRIPTION (Cash | Voucher). */
export interface TicketRepaymentMethod extends TicketOption {
  appliesTo: string | null;
}

/** Legacy flat `takenAs[]` item — distinct TAKES_AS across the caller's tickets. */
export interface TicketTakenAsOption {
  TAKES_AS: string;
  TAKEN_AS_AR: string | null;
}

/** Legacy flat `repaymentMethods[]` item — distinct FLEX_VALUE across the caller's tickets. */
export interface TicketRepaymentOption {
  FLEX_VALUE: string;
  DESCRIPTION: string | null;
  FLEX_VALUE_AR: string | null;
}

/** op 72 — `GET /annual-ticket/cancel-options` result. */
export interface TicketCancelOptions {
  tickets: TicketCancellable[];
  /** Kept for older clients; deduplicated, carries no per-ticket id. */
  takenAs: TicketTakenAsOption[];
  /** Kept for older clients; deduplicated, carries no per-ticket id. */
  repaymentMethods: TicketRepaymentOption[];
}

/** The caller's annual-ticket eligibility flag (ANNUAL_TICKT_LOV): `Yes` / `No` + Arabic twin. */
export interface TicketEligibility {
  eligible: 'Yes' | 'No' | null;
  eligibleAr: string | null;
}

/** `contractualYears[]` — TAG1 `CONTRACTUAL YEAR`; `value` (CONTRACT_YEAR) feeds `p_contractual_year`. */
export interface TicketContractualYear extends TicketOption {
  fromYear: number | null;
  toYear: number | null;
  law: string | null;
  totalCount: number | null;
}

/** `passengers[]` — TAG1 `PASSENGER`; `contactId` feeds `p_employee` (Self) / `p_passenger1..4` (Family). */
export interface TicketPassenger {
  contactId: string | null;
  name: string | null;
  nameAr: string | null;
  type: string | null;
  contactType: string | null;
  currentEmployee: string | null;
  dateOfBirth: string | null;
  sex: string | null;
}

/** A TICKET_MASTER row whose TAG1 is none of the known groups — kept so nothing is dropped. */
export interface TicketMasterOther extends TicketOption {
  tag: string | null;
  recordType: string | null;
}

/** The only `p_request_type` value known so far (AT-5 open: the master has no source for it). */
export const ANNUAL_TICKET_REQUEST_TYPE = 'Annual Ticket';

/**
 * op 66 — the annual-ticket form master: TICKET_MASTER rows of the caller
 * grouped by TAG1 (one array per mobile picker) plus the eligibility flag.
 */
export interface AnnualTicketMaster extends TicketEligibility {
  contractualYears: TicketContractualYear[];
  destinations: TicketOption[];
  passengers: TicketPassenger[];
  requestFor: TicketOption[];
  ticketClasses: TicketOption[];
  requestType: typeof ANNUAL_TICKET_REQUEST_TYPE;
  other: TicketMasterOther[];
}

/** Port: annual-ticket master (op 66), submit (op 67) and cancellation (op 72). */
export interface TicketRepository {
  apply(cmd: TicketRequestCommand): Promise<SubmitResult>;
  cancel(cmd: TicketRequestCommand): Promise<SubmitResult>;
  cancelOptions(personId: string): Promise<TicketCancelOptionRows>;
  /** The caller's Oracle PERSON_ID (EMPLOYMENT_DETAILS_V by USER_NAME), or null when there is none. */
  resolvePersonId(username: string): Promise<string | null>;
  /** The caller's raw TICKET_MASTER rows (`WHERE USER_NAME = :u`). */
  getMaster(username: string): Promise<Record<string, unknown>[]>;
  /** The caller's ANNUAL_TICKT_LOV flag; null when there is no row or the read failed (never throws). */
  getEligibility(username: string): Promise<TicketEligibility | null>;
}

export const TICKET_REPOSITORY = Symbol('TICKET_REPOSITORY');
