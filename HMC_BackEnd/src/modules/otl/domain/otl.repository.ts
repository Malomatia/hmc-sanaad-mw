import { SubmitResult } from '@shared/domain/submit-result';

/** One Oracle row under its raw column names; the service does the renaming. */
export type OtlRow = Record<string, unknown>;

/**
 * A read that degrades instead of failing. `available: false` means the view
 * could not be read at all (ORA-04063: XXHMC_SND_OTL_SUMMARY_V is INVALID,
 * Oracle bug B4), so the empty `rows` say nothing about the employee's data.
 */
export interface OtlDegradableRead {
  rows: OtlRow[];
  available: boolean;
}

/** Inclusive `YYYY-MM-DD` date window. */
export interface OtlDateWindow {
  from: string;
  to: string;
}

/**
 * XXHMC_SND_TIMECARD_SUBMIT_PR inputs. Oracle reads ONLY `entries` (the JSON
 * envelope, bound as the CLOB `p_entries`); the scalars carry the same values
 * for forward compatibility.
 */
export interface TimecardSubmitCommand {
  username: string;
  period: string;
  confirmationFlag: string;
  language: string;
  comments?: string;
  entries: string;
}

/** Port over XXHMC_SND_OTL_PKG and the XXHMC_SND_OTL_*_V views. Dates are `YYYY-MM-DD`. */
export interface OtlRepository {
  getAbsenceDetails(username: string, startDate: string, endDate: string): Promise<OtlRow[]>;
  getElementDetails(username: string, startDate: string, endDate: string): Promise<OtlRow[]>;
  getTemplate(username: string, startDate: string, endDate: string): Promise<OtlRow[]>;
  /** `requestor` is the timecard OWNER, not the approver (see get_time_card_details). */
  getTimecardNotificationDetails(notificationId: string, requestor: string): Promise<OtlRow[]>;
  /** True when `notificationId` is in `username`'s own worklist (WORKLISTS_V). */
  isWorklistRecipient(notificationId: string, username: string): Promise<boolean>;
  getElements(): Promise<OtlRow[]>;
  getSummary(username: string, window?: OtlDateWindow): Promise<OtlDegradableRead>;
  getSummaryByElement(username: string, periodStart: string): Promise<OtlRow[]>;
  getPeriods(username: string, year?: number): Promise<OtlRow[]>;
  getDetails(username: string, periodStart: string): Promise<OtlRow[]>;
  getFacilities(): Promise<OtlRow[]>;
  getCostCenters(facilityCode: string): Promise<OtlRow[]>;
  submitTimecard(cmd: TimecardSubmitCommand): Promise<SubmitResult>;
}

export const OTL_REPOSITORY = Symbol('OTL_REPOSITORY');
