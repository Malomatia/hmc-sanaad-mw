import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Lang } from '@shared/domain/lang';
import { SubmitResult } from '@shared/domain/submit-result';
import { ERROR_MESSAGES } from '@shared/constants/error-codes';
import { formatOracleIsoDate } from '@shared/utils/date.util';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import {
  AnnualTicketMaster,
  TICKET_REPOSITORY,
  TicketCancellable,
  TicketCancelOptionRows,
  TicketCancelOptions,
  TicketEligibility,
  TicketOption,
  TicketRepaymentMethod,
  TicketRepaymentOption,
  TicketRepository,
  TicketTakenAsOption,
} from '../domain/annual-ticket.repository';
import { parseTicketComposite } from './annual-ticket-composite.util';

type Row = Record<string, unknown>;

type MasterGroup = Exclude<keyof AnnualTicketMaster, keyof TicketEligibility>;

/** TICKET_MASTER `TAG1` value → response group; anything else lands in `other`. */
const MASTER_GROUPS: ReadonlyMap<string, MasterGroup> = new Map<string, MasterGroup>([
  ['CONTRACTUAL YEAR', 'contractualYears'],
  ['DESTINATION', 'destinations'],
  ['PASSENGER', 'passengers'],
  ['REQUEST FOR', 'requestFor'],
  ['REQ TYPE', 'requestTypes'],
  ['TICKET CLASS', 'ticketClasses'],
]);

/**
 * op 72 cancel body after validation (`AnnualTicketCancelRequestDto`): the
 * ticket id, the user's own text fields and attachments. Every Oracle list
 * value is resolved server-side from the ticket.
 */
export interface TicketCancelInput {
  analysis_criteria_id: string;
  p_repayment_method?: string;
  [key: string]: unknown;
}

const NOT_CANCELLABLE = 'Ticket not found or not cancellable for this user.';

const text = (value: unknown): string | null =>
  value === null || value === undefined || value === '' ? null : String(value);

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** ANALYSIS_CRITERIA_ID as a canonical digit string (`071794897` → `71794897`), or null. */
const idKey = (value: unknown): string | null => {
  const id = String(value ?? '').trim();
  return /^\d+$/.test(id) ? id.replace(/^0+(?=\d)/, '') : null;
};

const upper = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toUpperCase();

/** Annual-ticket service (ops 66, 67, 72). */
@Injectable()
export class AnnualTicketService {
  private readonly logger = new Logger(AnnualTicketService.name);

  constructor(@Inject(TICKET_REPOSITORY) private readonly repo: TicketRepository) {}

  /**
   * op 66 — the annual-ticket form master, always for the JWT caller:
   * TICKET_MASTER `WHERE USER_NAME = :u` grouped by TAG1 into the five mobile
   * pickers, plus the ANNUAL_TICKT_LOV eligibility flag (read in parallel; it
   * degrades to `eligible: null` and never fails the call). A client
   * `person_id` is only compared against the caller's own PERSON_ID (from the
   * master rows, else EMPLOYMENT_DETAILS_V) and answers 403 when it differs;
   * it is never used to query.
   */
  async master(
    user: AuthenticatedUser,
    query: { person_id?: string } = {},
  ): Promise<AnnualTicketMaster> {
    const eligibility = this.repo.getEligibility(user.username).catch((err: unknown) => {
      this.logger.warn(
        `[READ_DEGRADED] object=ANNUAL_TICKT_LOV failed: ${(err as Error).message} — eligible: null`,
      );
      return null;
    });
    const requestTypes = this.repo.getRequestTypes().catch((err: unknown) => {
      this.logger.warn(
        `[READ_DEGRADED] object=TICKET_MASTER (REQ TYPE) failed: ${(err as Error).message} — requestTypes: []`,
      );
      return [] as Row[];
    });
    const rows = AnnualTicketService.dedupe([
      ...(await this.repo.getMaster(user.username)),
      ...(await requestTypes),
    ]);
    const requested = query.person_id?.trim();
    if (requested) {
      const own =
        AnnualTicketService.ownPersonId(rows) ?? (await this.repo.resolvePersonId(user.username));
      if (own && !AnnualTicketService.samePersonId(requested, own)) {
        throw new ForbiddenException(ERROR_MESSAGES.FORBIDDEN);
      }
    }
    const flag = await eligibility;
    return {
      eligible: flag?.eligible ?? null,
      eligibleAr: flag?.eligibleAr ?? null,
      ...AnnualTicketService.group(rows),
    };
  }

  apply(fields: Record<string, unknown>, user: AuthenticatedUser, lang: Lang): Promise<SubmitResult> {
    return this.repo.apply({ username: user.username, lang, fields });
  }

  /**
   * op 72 — the caller's cancellable tickets, each joined on
   * ANALYSIS_CRITERIA_ID with its taken-as (Cash | Voucher) and its own
   * repayment methods. The three views are PERSON_ID-scoped with no USER_NAME
   * column, so the caller's PERSON_ID is resolved server-side from
   * EMPLOYMENT_DETAILS_V; a client `person_id` is only compared against it
   * (a different one is refused with 403) and never used to query.
   */
  async cancelOptions(
    user: AuthenticatedUser,
    query: { person_id?: string } = {},
  ): Promise<TicketCancelOptions> {
    const personId = await this.repo.resolvePersonId(user.username);
    if (!personId) {
      this.logger.warn(
        `No PERSON_ID in EMPLOYMENT_DETAILS_V for ${user.username}; returning empty cancel options.`,
      );
      return { tickets: [], takenAs: [], repaymentMethods: [] };
    }
    const requested = query.person_id?.trim();
    if (requested && !AnnualTicketService.samePersonId(requested, personId)) {
      throw new ForbiddenException(ERROR_MESSAGES.FORBIDDEN);
    }
    return this.joinCancelOptions(await this.repo.cancelOptions(personId));
  }

  /**
   * op 72 — submit the cancellation (CANCEL_TKT_PR). The client names the
   * ticket by `analysis_criteria_id` only; the ticket is looked up again in
   * the caller's own cancel options (404 when it is not there) and every
   * list value is taken from it: `p_annual_tkt` = its ANALYSIS_CRITERIA_ID,
   * `p_contractual_year` = its segment 6, `p_ticket_as` = its taken-as and
   * `p_repayment_method` = one of its own methods. The composite never
   * round-trips through the client (the staging WAF blocked it) and a
   * Cash/Voucher ↔ repayment mismatch cannot be submitted.
   *
   * `p_annual_tkt` carries the ID, not the composite ANNUAL_LEAVE_PASS_TKT_VALUE:
   * the procedure copies it into `lc_segment1 VARCHAR2(60)` (line 192) and the
   * composite reaches 109 characters (person 26023), which raised ORA-06502
   * on every cancel. Agreed with the Oracle team 2026-09-30: CANCEL_TKT_PR is
   * being changed to resolve the ticket by ANALYSIS_CRITERIA_ID; until that
   * version is deployed the procedure answers "no data found".
   */
  async cancel(body: TicketCancelInput, user: AuthenticatedUser, lang: Lang): Promise<SubmitResult> {
    const { analysis_criteria_id, p_repayment_method, ...userFields } = body;
    const id = idKey(analysis_criteria_id);
    const { tickets } = await this.cancelOptions(user);
    const ticket = id ? tickets.find((t) => t.analysisCriteriaId === id) : undefined;
    if (!ticket) throw new NotFoundException(NOT_CANCELLABLE);
    return this.repo.cancel({
      username: user.username,
      lang,
      fields: {
        ...userFields,
        p_annual_tkt: ticket.analysisCriteriaId,
        p_contractual_year: ticket.contractualYear,
        p_ticket_as: ticket.takenAs,
        p_repayment_method: AnnualTicketService.repaymentMethodFor(ticket, p_repayment_method),
      },
    });
  }

  /**
   * The repayment method to submit: the requested one when it is one of the
   * ticket's own (matched case-insensitively, sent in Oracle's spelling), the
   * only one when the ticket has exactly one, otherwise 400.
   */
  private static repaymentMethodFor(ticket: TicketCancellable, requested?: string): string {
    const methods = ticket.repaymentMethods
      .map((m) => m.value)
      .filter((v): v is string => v !== null);
    const wanted = requested?.trim();
    if (wanted) {
      const match = methods.find((m) => m.trim().toLowerCase() === wanted.toLowerCase());
      if (match) return match;
      throw new BadRequestException(
        methods.length
          ? `p_repayment_method must be one of this ticket's repayment methods: ${methods.join(', ')}.`
          : 'No repayment method is available for this ticket.',
      );
    }
    if (methods.length === 1) return methods[0];
    throw new BadRequestException(
      methods.length
        ? `This ticket has several repayment methods (${methods.join(', ')}); send p_repayment_method to choose one.`
        : 'No repayment method is available for this ticket.',
    );
  }

  /**
   * Joins the three raw views on ANALYSIS_CRITERIA_ID into one entry per
   * ticket, and deduplicates the legacy flat lists (the raw views repeat
   * the same TAKES_AS / FLEX_VALUE once per historical ticket).
   */
  private joinCancelOptions(raw: TicketCancelOptionRows): TicketCancelOptions {
    const takenAsById = new Map<string, Row>();
    const takenAs = new Map<string, TicketTakenAsOption>();
    for (const row of raw.takenAs) {
      const value = text(row.TAKES_AS);
      if (!value) continue;
      const key = idKey(row.ANALYSIS_CRITERIA_ID);
      if (key && !takenAsById.has(key)) takenAsById.set(key, row);
      if (!takenAs.has(value)) takenAs.set(value, { TAKES_AS: value, TAKEN_AS_AR: text(row.TAKEN_AS_AR) });
    }

    const methodsById = new Map<string, TicketRepaymentMethod[]>();
    const repaymentMethods = new Map<string, TicketRepaymentOption>();
    for (const row of raw.repaymentMethods) {
      const value = text(row.FLEX_VALUE);
      if (!value) continue;
      // `label`/`labelAr` are the twin the interceptor collapses, so both must
      // name the METHOD (FLEX_VALUE / FLEX_VALUE_AR); DESCRIPTION is the
      // taken-as the method applies to and travels separately.
      const labelAr = text(row.FLEX_VALUE_AR);
      const appliesTo = text(row.DESCRIPTION);
      const key = idKey(row.ANALYSIS_CRITERIA_ID);
      if (key) {
        const methods = methodsById.get(key) ?? [];
        if (!methods.some((m) => m.value === value)) methods.push({ value, label: value, labelAr, appliesTo });
        methodsById.set(key, methods);
      }
      if (!repaymentMethods.has(value)) {
        repaymentMethods.set(value, { FLEX_VALUE: value, DESCRIPTION: appliesTo, FLEX_VALUE_AR: labelAr });
      }
    }

    const tickets: TicketCancellable[] = [];
    const seen = new Set<string>();
    for (const row of raw.tickets) {
      const key = idKey(row.ANALYSIS_CRITERIA_ID);
      const value = text(row.ANNUAL_LEAVE_PASS_TKT_VALUE);
      if (!key || !value) {
        this.logger.warn(
          'CANCEL_TICKETS_V row without ANALYSIS_CRITERIA_ID or ticket value skipped (not cancellable by id).',
        );
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      const composite = parseTicketComposite(value);
      const taken = takenAsById.get(key);
      tickets.push({
        analysisCriteriaId: key,
        value,
        requestFor: composite.requestFor,
        employeeName: composite.employeeName,
        passengers: composite.passengers,
        contractualYear: composite.contractualYear,
        takenAs: text(taken?.TAKES_AS) ?? composite.takenAs,
        takenAsAr: taken ? text(taken.TAKEN_AS_AR) : null,
        amount: composite.amount,
        repaymentMethods: methodsById.get(key) ?? [],
      });
    }

    return {
      tickets,
      takenAs: [...takenAs.values()],
      repaymentMethods: [...repaymentMethods.values()],
    };
  }

  /** Numeric comparison, so `026023` still matches `26023`; anything non-numeric never matches. */
  private static samePersonId(requested: string, resolved: string): boolean {
    return /^\d+$/.test(requested) && Number(requested) === Number(resolved);
  }

  /** Drop rows that are identical apart from ROW_NUM (first occurrence wins, order kept). */
  private static dedupe(rows: Row[]): Row[] {
    const seen = new Set<string>();
    return rows.filter((row) => {
      const key = JSON.stringify(
        Object.keys(row)
          .filter((k) => k.toUpperCase() !== 'ROW_NUM')
          .sort()
          .map((k) => [k, row[k]]),
      );
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** The caller's PERSON_ID: the PASSENGER/Self row's CONTACT_ID, else any row's PERSON_ID. */
  private static ownPersonId(rows: Row[]): string | null {
    const self = rows.find(
      (row) => upper(row.TAG1) === 'PASSENGER' && upper(row.RECORD_TYPE) === 'SELF',
    );
    const candidates = [self?.CONTACT_ID, self?.PERSON_ID, ...rows.map((row) => row.PERSON_ID)];
    const id = candidates.map((v) => String(v ?? '').trim()).find((v) => /^\d+$/.test(v));
    return id ?? null;
  }

  private static group(rows: Row[]): Pick<AnnualTicketMaster, MasterGroup> {
    const out: Pick<AnnualTicketMaster, MasterGroup> = {
      contractualYears: [],
      destinations: [],
      passengers: [],
      requestFor: [],
      requestTypes: [],
      ticketClasses: [],
      other: [],
    };
    const option = (row: Row): TicketOption => ({
      value: text(row.NAME_EN),
      label: text(row.NAME_EN),
      labelAr: text(row.NAME_AR),
    });
    for (const row of rows) {
      const group = MASTER_GROUPS.get(upper(row.TAG1)) ?? 'other';
      switch (group) {
        case 'contractualYears':
          out.contractualYears.push({
            value: text(row.CONTRACT_YEAR) ?? text(row.NAME_EN),
            label: text(row.CONTRACT_YEAR_DEF) ?? text(row.NAME_EN) ?? text(row.CONTRACT_YEAR),
            labelAr: text(row.CONTRACT_YEAR_DEF_AR) ?? text(row.NAME_AR),
            fromYear: num(row.FROM_DATE),
            toYear: num(row.TOO_DATE),
            law: text(row.LAW),
            totalCount: num(row.TOT_COUNT),
          });
          break;
        case 'passengers':
          out.passengers.push({
            value: text(row.CONTACT_ID),
            contactId: text(row.CONTACT_ID),
            name: text(row.NAME_EN),
            nameAr: text(row.NAME_AR),
            type: text(row.RECORD_TYPE),
            contactType: text(row.CONTACT_TYPE),
            currentEmployee: text(row.CURRENT_EMPLOYEE_FLAG),
            dateOfBirth: formatOracleIsoDate(row.DATE_OF_BIRTH),
            sex: text(row.SEX),
          });
          break;
        case 'destinations':
        case 'requestFor':
        case 'requestTypes':
        case 'ticketClasses':
          out[group].push(option(row));
          break;
        default:
          out.other.push({ tag: text(row.TAG1), recordType: text(row.RECORD_TYPE), ...option(row) });
      }
    }
    const isSelf = (p: { type: string | null }) => upper(p.type) === 'SELF';
    out.passengers.sort((a, b) => Number(isSelf(b)) - Number(isSelf(a)));
    return out;
  }
}
