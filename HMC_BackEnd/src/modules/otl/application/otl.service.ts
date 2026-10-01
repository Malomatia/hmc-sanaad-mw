import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Lang } from '@shared/domain/lang';
import { failureResult, SubmitResult } from '@shared/domain/submit-result';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { OTL_REPOSITORY, OtlRepository, OtlRow } from '../domain/otl.repository';
import {
  dayCount,
  datesBetween,
  entryDateLabel,
  isWeekend,
  monthWindow,
  OTL_MAX_RANGE_DAYS,
  OTL_OVERTIME_ELEMENTS,
  OTL_SUBMIT_ELEMENT_NAMES,
  submitPeriodLabel,
  summaryPeriodLabel,
  timePeriodLabel,
  toIsoDate,
} from './otl-timecard.util';

/** A submitted facility / cost-center value must be the raw segment code; DETAILS_TBL holds 10 chars (B7). */
const SEGMENT_CODE = /^[A-Za-z0-9]{1,10}$/;

const ELEMENT_BY_KEY = new Map(OTL_SUBMIT_ELEMENT_NAMES.map((name) => [name.toLowerCase(), name]));

export interface OtlDateRange {
  startDate: string;
  endDate: string;
}

/** The submit request after DTO validation (see SubmitTimecardRequestDto). */
export interface TimecardSubmission {
  periodStart: string;
  p_confirmation_flag: 'Y';
  p_employee_notes?: string;
  p_entries: {
    p_hour_type_id: string;
    p_entry_date: string;
    p_value: number;
    p_cross_dept_flag: 'Y' | 'N';
    p_dept_id?: string;
    p_cost_center?: string;
    p_comments?: string;
  }[];
}

export interface OtlGridRow {
  hourType: string | null;
  facility: string | null;
  costCenter: string | null;
  totalHours: number;
  entries: { entryDate: string | null; value: number; locked: boolean }[];
}

const text = (row: OtlRow, column: string): string | null => {
  const value = row[column];
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
};

const num = (row: OtlRow, column: string): number | null => {
  const value = row[column];
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * OTL timecard (XXHMC_SND_OTL_PKG). The Oracle team split the screens across
 * several views and functions, so this service joins, groups and pivots the
 * flat rows into the mobile shape. The employee is ALWAYS the JWT caller.
 */
@Injectable()
export class OtlService {
  constructor(@Inject(OTL_REPOSITORY) private readonly repo: OtlRepository) {}

  async absenceDetails(user: AuthenticatedUser, range: OtlDateRange) {
    const { startDate, endDate } = OtlService.checkRange(range);
    const rows = await this.repo.getAbsenceDetails(user.username, startDate, endDate);
    return {
      items: rows.map((row) => ({
        employeeNumber: text(row, 'EMPLOYEE_NUMBER'),
        dateStart: toIsoDate(row.DATE_START) ?? null,
        dateEnd: toIsoDate(row.DATE_END) ?? null,
        absenceDays: num(row, 'ABSENCE_DAYS'),
      })),
    };
  }

  /** The hour-type picker for manual rows (facility-dependent: OT only for facility 09). */
  async elementDetails(user: AuthenticatedUser, range: OtlDateRange) {
    const { startDate, endDate } = OtlService.checkRange(range);
    const rows = await this.repo.getElementDetails(user.username, startDate, endDate);
    return { items: rows.map(OtlService.toElement) };
  }

  /** Display catalog only (ELEMENT_V) — it offers OT to everyone, so it must not feed the picker. */
  async elements() {
    return { items: (await this.repo.getElements()).map(OtlService.toElement) };
  }

  /**
   * One day per row with the scheduled `Regular Hours`, overlaid with the
   * caller's absences (clipped to the window; the rows carry no leave type).
   */
  async template(user: AuthenticatedUser, range: OtlDateRange) {
    const { startDate, endDate } = OtlService.checkRange(range);
    const [rows, absences] = await Promise.all([
      this.repo.getTemplate(user.username, startDate, endDate),
      this.repo.getAbsenceDetails(user.username, startDate, endDate),
    ]);
    const absent = OtlService.absentDays(absences, startDate, endDate);
    const days = rows
      .map((row) => {
        const date = toIsoDate(row.EFFECTIVE_DATE) ?? null;
        return {
          date,
          elementName: text(row, 'ELEMENT_NAME'),
          hours: num(row, 'HOURS') ?? 0,
          locked: date ? isWeekend(date) : false,
          absent: date ? absent.has(date) : false,
        };
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return { startDate, endDate, days };
  }

  /** Landing totals, one item per timecard. `available: false` = SUMMARY_V unreadable (B4). */
  async summary(user: AuthenticatedUser, period?: string) {
    const { rows, available } = await this.repo.getSummary(
      user.username,
      period ? { from: period, to: period } : undefined,
    );
    return {
      available,
      items: rows.map((row) => ({
        period: text(row, 'PERIOD'),
        startDate: toIsoDate(row.START_TIME) ?? null,
        endDate: toIsoDate(row.STOP_TIME) ?? null,
        recordedHours: num(row, 'RECORDED_HOURS'),
        absenceDays: num(row, 'ABSENCE_DAYS'),
        status: text(row, 'APPROVAL_STATUS'),
        timecardId: num(row, 'TIMECARD_ID'),
        comment: text(row, 'COMMENT_TEXT'),
      })),
    };
  }

  /** "By hours type": HOURS summed per element across facility/cost-center rows. FULL_NAME is ignored (B5). */
  async summaryByElement(user: AuthenticatedUser, period: string) {
    const rows = await this.repo.getSummaryByElement(user.username, period);
    const byElement = new Map<string, number>();
    for (const row of rows) {
      const name = text(row, 'ELEMENT_NAME') ?? '';
      byElement.set(name, (byElement.get(name) ?? 0) + (num(row, 'HOURS') ?? 0));
    }
    const elements = [...byElement.entries()].map(([elementName, hours]) => ({
      elementName,
      hours: round(hours),
    }));
    return {
      period: { startDate: period, label: summaryPeriodLabel(period) },
      status: rows.length ? text(rows[0], 'APPROVAL_STATUS') : null,
      recordedHours: rows.length ? num(rows[0], 'TOTAL_HOURS') : null,
      totalHours: round(elements.reduce((sum, e) => sum + e.hours, 0)),
      overtimeHours: round(
        elements
          .filter((e) => OTL_OVERTIME_ELEMENTS.includes(e.elementName))
          .reduce((sum, e) => sum + e.hours, 0),
      ),
      byElement: elements,
      rows: rows.map((row) => ({
        elementName: text(row, 'ELEMENT_NAME'),
        facility: text(row, 'FACILITY'),
        costCenter: text(row, 'COST_CENTER'),
        hours: num(row, 'HOURS'),
      })),
    };
  }

  /**
   * Periods the caller may submit, each with a status derived from the
   * SUMMARY_V row of the same month: none or WORKING = OPEN, SUBMITTED,
   * APPROVED, REJECTED and ERROR pass through, and UNKNOWN when SUMMARY_V
   * could not be read (B4) — never a misleading OPEN.
   */
  async periods(user: AuthenticatedUser, filters: { year?: string; status?: string }) {
    const periods = await this.repo.getPeriods(
      user.username,
      filters.year ? Number(filters.year) : undefined,
    );
    const starts = periods.map((p) => toIsoDate(p.START_DATE)).filter((d): d is string => !!d);
    const ends = periods.map((p) => toIsoDate(p.END_DATE)).filter((d): d is string => !!d);
    const summary = starts.length
      ? await this.repo.getSummary(user.username, {
          from: starts.reduce((a, b) => (a < b ? a : b)),
          to: [...starts, ...ends].reduce((a, b) => (a > b ? a : b)),
        })
      : { rows: [], available: true };
    const byMonth = OtlService.latestByMonth(summary.rows);

    const items = periods.map((row) => {
      const startDate = toIsoDate(row.START_DATE) ?? null;
      const endDate = toIsoDate(row.END_DATE) ?? null;
      const card = startDate
        ? (byMonth.get(startDate.slice(0, 7)) ?? byMonth.get(summaryPeriodLabel(startDate)))
        : undefined;
      return {
        timePeriodId: num(row, 'TIME_PERIOD_ID'),
        startDate,
        endDate,
        label:
          text(row, 'PERIOD') ??
          (startDate && endDate ? timePeriodLabel(startDate, endDate) : null),
        status: summary.available ? OtlService.periodStatus(card) : 'UNKNOWN',
        recordedHours: card ? num(card, 'RECORDED_HOURS') : null,
        absenceDays: card ? num(card, 'ABSENCE_DAYS') : null,
        timecardId: card ? num(card, 'TIMECARD_ID') : null,
      };
    });
    return {
      summaryAvailable: summary.available,
      items: filters.status ? items.filter((p) => p.status === filters.status) : items,
    };
  }

  /**
   * The grid of a submitted card, grouped by element + facility + cost center
   * and keyed by day. A WORKING or not-yet-created card has no DEATIS_V rows
   * (the view inner-joins the approver), so the month template is returned.
   */
  async details(user: AuthenticatedUser, period: string) {
    const rows = await this.repo.getDetails(user.username, period);
    const window = {
      startDate: period,
      endDate: monthWindow(period).to,
      label: summaryPeriodLabel(period),
    };
    if (rows.length) {
      const head = rows[0];
      return {
        source: 'timecard' as const,
        period: window,
        header: {
          timecardId: num(head, 'TIMECARD_ID'),
          status: text(head, 'APPROVAL_STATUS'),
          submittedBy: text(head, 'SUBMITTED_BY'),
          submissionDate: toIsoDate(head.SUBMISSION_DATE) ?? null,
          approvedBy: text(head, 'APPROVE_BY'),
          approvalDate: toIsoDate(head.APPROVAL_DATE) ?? null,
        },
        rows: OtlService.toGrid(rows),
      };
    }
    const template = await this.repo.getTemplate(user.username, window.startDate, window.endDate);
    return {
      source: 'template' as const,
      period: window,
      header: null,
      rows: OtlService.toGrid(template.map((row) => ({ ...row, DAY: row.EFFECTIVE_DATE }))),
    };
  }

  /**
   * An approver opening a timecard notification. `requestor` is the timecard
   * owner the function needs; the caller must be the notification's
   * recipient (see assertWorklistRecipient). An empty result means "not an
   * OTL notification or wrong requestor" and is returned as such, not as 500.
   */
  async timecardNotificationDetails(
    user: AuthenticatedUser,
    notificationId: string,
    requestor: string,
  ) {
    if (!/^\d{1,15}$/.test(notificationId)) {
      throw new BadRequestException('id must be a numeric notification id.');
    }
    await this.assertWorklistRecipient(notificationId, user);
    const rows = await this.repo.getTimecardNotificationDetails(notificationId, requestor);
    if (!rows.length) return { header: null, rows: [] };
    const head = rows[0];
    return {
      header: {
        fullName: text(head, 'FULL_NAME'),
        employeeNumber: text(head, 'EMPLOYEE_NUMBER'),
        period: text(head, 'PERIOD'),
        startDate: toIsoDate(head.START_TIME) ?? null,
        endDate: toIsoDate(head.STOP_TIME) ?? null,
        timecardId: num(head, 'TIMECARD_ID'),
        status: text(head, 'APPROVAL_STATUS'),
        submittedBy: text(head, 'SUBMITTED_BY'),
        submissionDate: toIsoDate(head.SUBMISSION_DATE) ?? null,
        comments: text(head, 'COMMENTS'),
      },
      rows: OtlService.toGrid(rows),
    };
  }

  /**
   * Guard for plan 4.8: notification ids are sequential, and the function
   * returns any owner's card for a matching (id, owner) pair, so only the
   * notification's own recipient may ask. The item key the function joins on
   * comes from the notification itself, so a wrong `requestor` can only
   * produce an empty result, never another person's card.
   */
  private async assertWorklistRecipient(
    notificationId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    if (!(await this.repo.isWorklistRecipient(notificationId, user.username))) {
      throw new ForbiddenException('This notification is not in your worklist.');
    }
  }

  async facilities() {
    const rows = await this.repo.getFacilities();
    return {
      items: rows.map((row) => ({
        facilityCode: text(row, 'FACILITY_CODE'),
        facilityName: text(row, 'FACILITY'),
        description: text(row, 'DESCRIPTION'),
      })),
    };
  }

  async costCenters(facilityCode: string) {
    const rows = await this.repo.getCostCenters(facilityCode.trim());
    return {
      items: rows.map((row) => ({
        facilityCode: text(row, 'FACILITY_CODE'),
        costCenterCode: text(row, 'COST_CENTER_CODE'),
        costCenterName: text(row, 'COST_CENTER'),
        description: text(row, 'COST_CENTER_DESCRIPTION'),
      })),
    };
  }

  /**
   * Builds the JSON envelope XXHMC_SND_TIMECARD_SUBMIT_PR parses (it ignores
   * its scalar INs): `p_user_name` is the JWT caller whatever the body says,
   * `p_period` is `Month YYYY` and each `p_entry_date` `DD-Mon-YYYY`, both in
   * English. The cheap `run_validate` rules — and the ones Oracle does not
   * enforce (B2/B3) — are checked first, so the caller gets a clear `N`
   * without an Oracle round trip.
   */
  async submit(
    body: TimecardSubmission,
    user: AuthenticatedUser,
    lang: Lang,
  ): Promise<SubmitResult> {
    const problem = OtlService.validateEntries(body);
    if (problem) {
      return {
        ...failureResult(problem),
        result: { referenceNo: null, submittedDate: null, cardStatus: null, approvalChain: [] },
      };
    }
    const username = user.username.toUpperCase();
    const period = submitPeriodLabel(body.periodStart);
    const language = lang.toUpperCase();
    const envelope = {
      p_user_name: username,
      p_period: period,
      p_confirmation_flag: body.p_confirmation_flag,
      p_language: language,
      p_employee_notes: body.p_employee_notes,
      p_entries: body.p_entries.map((entry) => ({
        p_hour_type_id: ELEMENT_BY_KEY.get(entry.p_hour_type_id.trim().toLowerCase()),
        p_entry_date: entryDateLabel(entry.p_entry_date),
        p_value: entry.p_value,
        p_cross_dept_flag: entry.p_cross_dept_flag,
        p_dept_id: entry.p_dept_id?.trim(),
        p_cost_center: entry.p_cost_center?.trim(),
        p_comments: entry.p_comments,
      })),
    };
    return this.repo.submitTimecard({
      username,
      period,
      confirmationFlag: body.p_confirmation_flag,
      language,
      comments: body.p_employee_notes,
      entries: JSON.stringify(envelope),
    });
  }

  /** First failed pre-submit rule as a user-facing message, or undefined. */
  private static validateEntries(body: TimecardSubmission): string | undefined {
    const { from, to } = monthWindow(body.periodStart);
    const perDay = new Map<string, number>();
    for (const entry of body.p_entries) {
      if (!ELEMENT_BY_KEY.has(entry.p_hour_type_id.trim().toLowerCase())) {
        return `Unknown hour type "${entry.p_hour_type_id}". Use an element name from GET /otl/element-details.`;
      }
      if (entry.p_entry_date < from || entry.p_entry_date > to) {
        return `Entry date ${entry.p_entry_date} is outside the period ${submitPeriodLabel(from)}.`;
      }
      for (const [field, value] of [
        ['p_dept_id', entry.p_dept_id],
        ['p_cost_center', entry.p_cost_center],
      ] as const) {
        if (value !== undefined && !SEGMENT_CODE.test(value.trim())) {
          return `${field} must be the raw code (up to 10 letters/digits), not the "code-description" label.`;
        }
      }
      perDay.set(entry.p_entry_date, (perDay.get(entry.p_entry_date) ?? 0) + entry.p_value);
    }
    for (const [date, hours] of perDay) {
      if (hours > 24)
        return `The entries of ${date} total ${round(hours)} hours; a day allows at most 24.`;
    }
    const missing = datesBetween(from, to).filter((date) => !perDay.has(date));
    if (missing.length) {
      return (
        `Partial records: every day of ${submitPeriodLabel(from)} needs at least one entry ` +
        `(missing ${missing.join(', ')}).`
      );
    }
    return undefined;
  }

  private static checkRange(range: OtlDateRange): OtlDateRange {
    const days = dayCount(range.startDate, range.endDate);
    if (days === 0) throw new BadRequestException('endDate must not be before startDate.');
    if (days > OTL_MAX_RANGE_DAYS) {
      throw new BadRequestException(`The date range may cover at most ${OTL_MAX_RANGE_DAYS} days.`);
    }
    return range;
  }

  private static toElement(row: OtlRow) {
    return { elementTypeId: num(row, 'ELEMENT_TYPE_ID'), elementName: text(row, 'ELEMENT_NAME') };
  }

  /** Days in [startDate, endDate] covered by an absence (rows may extend outside the window). */
  private static absentDays(rows: OtlRow[], startDate: string, endDate: string): Set<string> {
    const days = new Set<string>();
    for (const row of rows) {
      const first = toIsoDate(row.DATE_START);
      const last = toIsoDate(row.DATE_END) ?? first;
      if (!first || !last) continue;
      const from = first > startDate ? first : startDate;
      const to = last < endDate ? last : endDate;
      if (from <= to) datesBetween(from, to).forEach((date) => days.add(date));
    }
    return days;
  }

  /**
   * SUMMARY_V rows keyed by month — `YYYY-MM` of START_TIME and, as a
   * fallback, the `Mon YYYY` PERIOD text — keeping the newest timecard when a
   * month has several (a rejected card and its resubmission).
   */
  private static latestByMonth(rows: OtlRow[]): Map<string, OtlRow> {
    const byMonth = new Map<string, OtlRow>();
    const keep = (key: string | undefined | null, row: OtlRow) => {
      if (!key) return;
      const current = byMonth.get(key);
      if (!current || (num(row, 'TIMECARD_ID') ?? 0) > (num(current, 'TIMECARD_ID') ?? 0)) {
        byMonth.set(key, row);
      }
    };
    for (const row of rows) {
      keep(toIsoDate(row.START_TIME)?.slice(0, 7), row);
      keep(text(row, 'PERIOD'), row);
    }
    return byMonth;
  }

  private static periodStatus(card: OtlRow | undefined): string {
    const status = card ? text(card, 'APPROVAL_STATUS')?.toUpperCase() : undefined;
    return !status || status === 'WORKING' ? 'OPEN' : status;
  }

  /** Flat day rows -> one grid row per ELEMENT_NAME + FACILITY + COST_CENTER, entries by DAY. */
  static toGrid(rows: OtlRow[]): OtlGridRow[] {
    const grid = new Map<string, OtlGridRow>();
    for (const row of rows) {
      const hourType = text(row, 'ELEMENT_NAME');
      const facility = text(row, 'FACILITY');
      const costCenter = text(row, 'COST_CENTER');
      const key = JSON.stringify([hourType, facility, costCenter]);
      const line = grid.get(key) ?? { hourType, facility, costCenter, totalHours: 0, entries: [] };
      const entryDate = toIsoDate(row.DAY) ?? null;
      const value = num(row, 'HOURS') ?? 0;
      line.entries.push({ entryDate, value, locked: entryDate ? isWeekend(entryDate) : false });
      line.totalHours = round(line.totalHours + value);
      grid.set(key, line);
    }
    for (const line of grid.values()) {
      line.entries.sort((a, b) => String(a.entryDate).localeCompare(String(b.entryDate)));
    }
    return [...grid.values()];
  }
}
