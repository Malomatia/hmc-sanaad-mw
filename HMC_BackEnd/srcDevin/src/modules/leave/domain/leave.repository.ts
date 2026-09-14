import { Lang } from '@shared/domain/lang';
import { SubmitResult } from '@shared/domain/submit-result';

export interface LeaveBalance {
  plan?: string;
  entitlement?: string;
  taken?: string;
  balance?: string;
  [extra: string]: unknown;
}

/**
 * A field literally named `successflag` here would make
 * `ResponseInterceptor.isSubmitResult()` misidentify this read result as a
 * `_PR` action envelope, discarding `days` (only `status`/`successflag`/
 * `message`/`result` are forwarded for that shape) — hence
 * `successFlag`/`errorMessage` (camelCase) rather than the Oracle bind names.
 */
export interface LeaveDuration {
  days?: number;
  successFlag?: string;
  errorMessage?: string;
}

export interface LeaveBalanceQuery {
  /** Oracle username — bound to p_user_name exactly as received. */
  username?: string;
  /** Legacy alias (?person_id=) — bound as-is when username is absent. */
  personId?: string;
  lang: Lang;
  accrualPlan?: string;
  effectiveDate: string;
}

/**
 * One row of ABSENCE_V — the user's leave history (GET /leaves). The `*Ar`
 * twins are collapsed per-request by the ResponseInterceptor (the base field
 * carries the value for the request's `lang`).
 */
export interface LeaveRecord {
  absenceType?: string;
  absenceTypeAr?: string;
  absenceReason?: string;
  absenceReasonAr?: string;
  actualStartDate?: string;
  actualEndDate?: string;
  absenceDays?: number | string;
}

/**
 * The three return-from-leave LOV views feeding op 56's p_leave_details /
 * p_related_leave1 / p_related_leave2 (RFL_LEAVE_DET_V, RFL_REL_LEAVE1_V,
 * RFL_REL_LEAVE2_V). Read raw — ALL view columns are returned (confirmed
 * RFL_LEAVE_DET_V layout: USER_NAME VARCHAR2(100), ABSENCE_ATTENDANCE_ID
 * NUMBER(10), LEAVE VARCHAR2(94)).
 */
export type RflLovKind = 'details' | 'related1' | 'related2';

/** GET /leaves — `?user_name=&leave_type=` against ABSENCE_V. */
export interface LeaveListQuery {
  username: string;
  /** Optional ABSENCE_TYPE filter (English value, e.g. `Casual Leave`). */
  leaveType?: string;
}

/** op 10 — Apply leave (LEAV_OF_ABSEN_NEW_PR, ~50 binds). */
export interface LeaveApplyCommand {
  username: string;
  lang: Lang;
  absenceType: string;
  absenceReason?: string;
  startDate: string;
  endDate: string;
  /** Additional documented binds captured over time. */
  extra?: Record<string, unknown>;
}

export interface LeaveCalcCommand {
  username: string;
  lang: Lang;
  absenceType: string;
  startDate: string;
  endDate: string;
}

export interface LeaveMutationCommand {
  username: string;
  lang: Lang;
  fields: Record<string, unknown>;
}

/**
 * Port for leave procedures. LOV reads (12,13,14,45,46,55,61,62) flow through
 * the shared LookupsService, not this port. Employment context (for 45) is read
 * here directly from EMPLOYMENT_DETAILS_V to avoid importing the employee module.
 */
export interface LeaveRepository {
  getBalance(query: LeaveBalanceQuery): Promise<LeaveBalance[]>;
  list(query: LeaveListQuery): Promise<LeaveRecord[]>;
  apply(cmd: LeaveApplyCommand): Promise<SubmitResult>;
  calculate(cmd: LeaveCalcCommand): Promise<LeaveDuration>;
  amend(cmd: LeaveMutationCommand): Promise<SubmitResult>;
  cancel(cmd: LeaveMutationCommand): Promise<SubmitResult>;
  returnFromLeave(cmd: LeaveMutationCommand): Promise<SubmitResult>;
  /** Full rows of a return-from-leave LOV view, scoped by USER_NAME. */
  rflLov(kind: RflLovKind, username: string): Promise<Record<string, unknown>[]>;
  getEmploymentContext(employeeNumber: string): Promise<Record<string, unknown> | undefined>;
}

export const LEAVE_REPOSITORY = Symbol('LEAVE_REPOSITORY');
