import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as oracledb from 'oracledb';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { OracleContractCatalog } from '@core/database/oracle-contracts';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { OtlOracleRepository } from '../infrastructure/oracle/otl.oracle.repository';
import { OtlRepository } from '../domain/otl.repository';
import { OtlService, TimecardSubmission } from './otl.service';
import {
  entryDateLabel,
  isWeekend,
  submitPeriodLabel,
  summaryPeriodLabel,
  timePeriodLabel,
  toIsoDate,
} from './otl-timecard.util';

const USER: AuthenticatedUser = { username: 'aibrahim39', roles: [] };
const JULY = Array.from({ length: 31 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`);

function fullJuly(overrides: Partial<TimecardSubmission> = {}): TimecardSubmission {
  return {
    periodStart: '2026-07-01',
    p_confirmation_flag: 'Y',
    p_employee_notes: 'July timecard',
    p_entries: JULY.map((date) => ({
      p_hour_type_id: 'regular hours',
      p_entry_date: date,
      p_value: isWeekend(date) ? 0 : 8,
      p_cross_dept_flag: 'N' as const,
    })),
    ...overrides,
  };
}

describe('OTL period derivations', () => {
  it('derives every Oracle period format from the TIME_PERIOD_V START_DATE', () => {
    expect(submitPeriodLabel('2026-07-01')).toBe('July 2026');
    expect(summaryPeriodLabel('2026-07-01')).toBe('Jul 2026');
    expect(summaryPeriodLabel('2026-09-01')).toBe('Sep 2026');
    expect(timePeriodLabel('2026-09-01', '2026-09-30')).toBe(
      'September 01, 2026 - September 30, 2026',
    );
    expect(entryDateLabel('2026-07-09')).toBe('09-Jul-2026');
  });

  it('reads an Oracle DATE by its local calendar day and computes the Fri/Sat weekend', () => {
    expect(toIsoDate(new Date(2026, 6, 1))).toBe('2026-07-01');
    expect(toIsoDate('2026-07-01T00:00:00')).toBe('2026-07-01');
    expect(isWeekend('2026-07-03')).toBe(true);
    expect(isWeekend('2026-07-04')).toBe(true);
    expect(isWeekend('2026-07-05')).toBe(false);
  });
});

/**
 * Submit through the real repository and static catalog, with only the
 * driver mocked: what reaches Oracle is the CLOB JSON envelope, so that is
 * what these tests read back.
 */
describe('OtlService.submit', () => {
  function make(
    scalars: Record<string, unknown> = { p_success_flag: 'S', p_error_msg: 'Success' },
    cursors = {},
  ) {
    const callMultiCursor = jest.fn().mockResolvedValue({ cursors, scalars });
    const ora = { callMultiCursor } as unknown as OracleService;
    const repo = new OtlOracleRepository(ora, new OracleSchemaService(new OracleContractCatalog()));
    const sent = () => {
      const binds = callMultiCursor.mock.calls[0][1] as Record<string, any>;
      return { binds, json: JSON.parse(binds.p_entries.val as string) };
    };
    return { service: new OtlService(repo), callMultiCursor, sent };
  }

  it('writes the JWT username into the JSON even when the body carries another one', async () => {
    const { service, sent } = make();
    const spoofed = {
      ...fullJuly(),
      p_user_name: 'SPOOF',
      p_period: 'January 1999',
    } as TimecardSubmission;

    await service.submit(spoofed, USER, 'en');

    const { json, binds } = sent();
    expect(json.p_user_name).toBe('AIBRAHIM39');
    expect(json.p_period).toBe('July 2026');
    expect(binds.p_user_name).toBe('AIBRAHIM39');
    expect(binds.p_period).toBe('July 2026');
    expect(binds.p_entries.type).toBe(oracledb.DB_TYPE_CLOB);
  });

  it('builds the findings §4 envelope: English period, DD-Mon-YYYY dates, element NAMES', async () => {
    const { service, sent } = make();
    const body = fullJuly();
    body.p_entries.push({
      p_hour_type_id: 'Regular OT',
      p_entry_date: '2026-07-09',
      p_value: 2,
      p_cross_dept_flag: 'Y',
      p_dept_id: '09',
      p_cost_center: '4471',
      p_comments: 'Corporate event support',
    });

    await service.submit(body, USER, 'ar');

    const { json, binds } = sent();
    expect(Object.keys(json)).toEqual([
      'p_user_name',
      'p_period',
      'p_confirmation_flag',
      'p_language',
      'p_employee_notes',
      'p_entries',
    ]);
    expect(json).toMatchObject({
      p_confirmation_flag: 'Y',
      p_language: 'AR',
      p_employee_notes: 'July timecard',
    });
    expect(json.p_entries).toHaveLength(32);
    expect(json.p_entries[0]).toEqual({
      p_hour_type_id: 'Regular Hours',
      p_entry_date: '01-Jul-2026',
      p_value: 8,
      p_cross_dept_flag: 'N',
    });
    expect(json.p_entries[31]).toEqual({
      p_hour_type_id: 'Regular OT',
      p_entry_date: '09-Jul-2026',
      p_value: 2,
      p_cross_dept_flag: 'Y',
      p_dept_id: '09',
      p_cost_center: '4471',
      p_comments: 'Corporate event support',
    });
    expect(binds).toMatchObject({
      p_language: 'AR',
      p_confirmation_flag: 'Y',
      p_comments: 'July timecard',
    });
  });

  it('translates Oracle E to N and returns [] for the NULL approval chain', async () => {
    const { service } = make({
      p_success_flag: 'E',
      p_error_msg: 'Time card already exists with status of SUBMITTED',
      p_reference_no: null,
      p_card_status: null,
    });

    const result = await service.submit(fullJuly(), USER, 'en');

    expect(result).toMatchObject({
      successflag: 'N',
      status: 'error',
      errormessage: 'Time card already exists with status of SUBMITTED',
      result: { referenceNo: null, cardStatus: null, approvalChain: [] },
    });
  });

  it.each([
    ['a partial month', (b: TimecardSubmission) => b.p_entries.splice(2, 1), 'Partial records'],
    [
      'an unknown element',
      (b: TimecardSubmission) => (b.p_entries[0].p_hour_type_id = 'OT_REG'),
      'Unknown hour type',
    ],
    [
      'more than 24 hours on a day',
      (b: TimecardSubmission) =>
        b.p_entries.push({
          p_hour_type_id: 'Regular OT',
          p_entry_date: '2026-07-01',
          p_value: 17,
          p_cross_dept_flag: 'N',
        }),
      'at most 24',
    ],
    [
      'a code-description label instead of a facility code',
      (b: TimecardSubmission) =>
        Object.assign(b.p_entries[5], {
          p_cross_dept_flag: 'Y',
          p_dept_id: '09-Hamad General Hospital',
          p_cost_center: '4471',
        }),
      'p_dept_id must be the raw code',
    ],
    [
      'a date outside the period',
      (b: TimecardSubmission) =>
        b.p_entries.push({
          p_hour_type_id: 'Regular Hours',
          p_entry_date: '2026-08-01',
          p_value: 0,
          p_cross_dept_flag: 'N',
        }),
      'outside the period',
    ],
  ])('answers N without calling Oracle for %s', async (_case, mutate, message) => {
    const { service, callMultiCursor } = make();
    const body = fullJuly();
    mutate(body);

    const result = await service.submit(body, USER, 'en');

    expect(result.successflag).toBe('N');
    expect(result.errormessage).toContain(message);
    expect(callMultiCursor).not.toHaveBeenCalled();
  });
});

describe('OtlService reads', () => {
  function mockRepo(overrides: Partial<OtlRepository> = {}): jest.Mocked<OtlRepository> {
    return {
      getAbsenceDetails: jest.fn().mockResolvedValue([]),
      getElementDetails: jest.fn().mockResolvedValue([]),
      getTemplate: jest.fn().mockResolvedValue([]),
      getTimecardNotificationDetails: jest.fn().mockResolvedValue([]),
      isWorklistRecipient: jest.fn().mockResolvedValue(true),
      getElements: jest.fn().mockResolvedValue([]),
      getSummary: jest.fn().mockResolvedValue({ rows: [], available: true }),
      getSummaryByElement: jest.fn().mockResolvedValue([]),
      getPeriods: jest.fn().mockResolvedValue([]),
      getDetails: jest.fn().mockResolvedValue([]),
      getFacilities: jest.fn().mockResolvedValue([]),
      getCostCenters: jest.fn().mockResolvedValue([]),
      submitTimecard: jest.fn(),
      ...overrides,
    } as jest.Mocked<OtlRepository>;
  }

  const period = (month: number, id: number) => {
    const start = new Date(2026, month - 1, 1);
    const end = new Date(2026, month, 0);
    return {
      TIME_PERIOD_ID: id,
      USER_NAME: 'AIBRAHIM39',
      START_DATE: start,
      END_DATE: end,
      PERIOD: timePeriodLabel(toIsoDate(start)!, toIsoDate(end)!),
    };
  };
  const card = (month: number, status: string, id: number) => ({
    START_TIME: new Date(2026, month - 1, 1),
    STOP_TIME: new Date(2026, month, 0),
    PERIOD: summaryPeriodLabel(`2026-${String(month).padStart(2, '0')}-01`),
    APPROVAL_STATUS: status,
    RECORDED_HOURS: 160,
    ABSENCE_DAYS: 1,
    TIMECARD_ID: id,
  });

  it('derives each period status from the SUMMARY_V row of the same month', async () => {
    const repo = mockRepo({
      getPeriods: jest
        .fn()
        .mockResolvedValue([period(8, 8), period(7, 7), period(6, 6), period(5, 5), period(4, 4)]),
      getSummary: jest.fn().mockResolvedValue({
        rows: [
          card(7, 'SUBMITTED', 700),
          card(6, 'APPROVED', 600),
          card(5, 'WORKING', 500),
          card(4, 'ERROR', 400),
          card(4, 'REJECTED', 401),
        ],
        available: true,
      }),
    });
    const result = await new OtlService(repo).periods(USER, {});

    expect(result.items.map((p) => [p.startDate, p.status, p.timecardId])).toEqual([
      ['2026-08-01', 'OPEN', null],
      ['2026-07-01', 'SUBMITTED', 700],
      ['2026-06-01', 'APPROVED', 600],
      ['2026-05-01', 'OPEN', 500],
      ['2026-04-01', 'REJECTED', 401],
    ]);
    expect(result.items[1].label).toBe('July 01, 2026 - July 31, 2026');
    expect(repo.getSummary).toHaveBeenCalledWith('aibrahim39', {
      from: '2026-04-01',
      to: '2026-08-31',
    });
  });

  it('reports UNKNOWN, never OPEN, when SUMMARY_V could not be read, and filters on status', async () => {
    const repo = mockRepo({
      getPeriods: jest.fn().mockResolvedValue([period(7, 7)]),
      getSummary: jest.fn().mockResolvedValue({ rows: [], available: false }),
    });
    const service = new OtlService(repo);

    await expect(service.periods(USER, {})).resolves.toMatchObject({
      summaryAvailable: false,
      items: [{ status: 'UNKNOWN' }],
    });
    await expect(service.periods(USER, { status: 'OPEN' })).resolves.toMatchObject({ items: [] });
  });

  it('groups DEATIS_V rows by element + facility + cost center, keyed and sorted by day', async () => {
    const day = (d: number, element: string, hours: number, cc = '4410') => ({
      ELEMENT_NAME: element,
      FACILITY: '09',
      COST_CENTER: cc,
      HOURS: hours,
      DAY: new Date(2026, 6, d),
      TIMECARD_ID: 700,
      APPROVAL_STATUS: 'SUBMITTED',
      SUBMISSION_DATE: new Date(2026, 7, 2),
    });
    const repo = mockRepo({
      getDetails: jest
        .fn()
        .mockResolvedValue([
          day(2, 'Regular Hours', 8),
          day(1, 'Regular Hours', 8),
          day(3, 'Regular Hours', 0),
          day(9, 'Regular OT', 2, '4471'),
        ]),
    });
    const result = await new OtlService(repo).details(USER, '2026-07-01');

    expect(result.source).toBe('timecard');
    expect(result.header).toMatchObject({
      timecardId: 700,
      status: 'SUBMITTED',
      submissionDate: '2026-08-02',
    });
    expect(result.rows).toEqual([
      {
        hourType: 'Regular Hours',
        facility: '09',
        costCenter: '4410',
        totalHours: 16,
        entries: [
          { entryDate: '2026-07-01', value: 8, locked: false },
          { entryDate: '2026-07-02', value: 8, locked: false },
          { entryDate: '2026-07-03', value: 0, locked: true },
        ],
      },
      {
        hourType: 'Regular OT',
        facility: '09',
        costCenter: '4471',
        totalHours: 2,
        entries: [{ entryDate: '2026-07-09', value: 2, locked: false }],
      },
    ]);
    expect(repo.getTemplate).not.toHaveBeenCalled();
  });

  it('falls back to the month template when the card has no DEATIS_V rows yet', async () => {
    const repo = mockRepo({
      getTemplate: jest
        .fn()
        .mockResolvedValue([
          { ELEMENT_NAME: 'Regular Hours', HOURS: 8, EFFECTIVE_DATE: new Date(2026, 1, 1) },
        ]),
    });
    const result = await new OtlService(repo).details(USER, '2026-02-01');

    expect(repo.getTemplate).toHaveBeenCalledWith('aibrahim39', '2026-02-01', '2026-02-28');
    expect(result).toMatchObject({
      source: 'template',
      header: null,
      rows: [{ hourType: 'Regular Hours', totalHours: 8 }],
    });
  });

  it('marks template days covered by an absence, clipped to the window', async () => {
    const repo = mockRepo({
      getTemplate: jest.fn().mockResolvedValue([
        { ELEMENT_NAME: 'Regular Hours', HOURS: 8, EFFECTIVE_DATE: new Date(2026, 6, 1) },
        { ELEMENT_NAME: 'Regular Hours', HOURS: 8, EFFECTIVE_DATE: new Date(2026, 6, 2) },
      ]),
      getAbsenceDetails: jest
        .fn()
        .mockResolvedValue([
          { DATE_START: new Date(2026, 5, 28), DATE_END: new Date(2026, 6, 1), ABSENCE_DAYS: 4 },
        ]),
    });
    const result = await new OtlService(repo).template(USER, {
      startDate: '2026-07-01',
      endDate: '2026-07-02',
    });
    expect(result.days.map((d) => [d.date, d.absent])).toEqual([
      ['2026-07-01', true],
      ['2026-07-02', false],
    ]);
  });

  it('rejects reversed or oversized date windows before calling Oracle', async () => {
    const repo = mockRepo();
    const service = new OtlService(repo);
    await expect(
      service.absenceDetails(USER, { startDate: '2026-07-31', endDate: '2026-07-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.template(USER, { startDate: '2026-01-01', endDate: '2026-06-30' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.getAbsenceDetails).not.toHaveBeenCalled();
    expect(repo.getTemplate).not.toHaveBeenCalled();
  });

  describe('approval-notification details (plan 4.8)', () => {
    it('400 for a non-numeric id, before any Oracle call', async () => {
      const repo = mockRepo();
      await expect(
        new OtlService(repo).timecardNotificationDetails(USER, 'abc', 'V-NFERNANDO'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.isWorklistRecipient).not.toHaveBeenCalled();
    });

    it("403 when the notification is not in the caller's worklist; the function is never called", async () => {
      const repo = mockRepo({ isWorklistRecipient: jest.fn().mockResolvedValue(false) });
      await expect(
        new OtlService(repo).timecardNotificationDetails(USER, '123864402', 'V-NFERNANDO'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.isWorklistRecipient).toHaveBeenCalledWith('123864402', 'aibrahim39');
      expect(repo.getTimecardNotificationDetails).not.toHaveBeenCalled();
    });

    it('passes the OWNER to the function and returns an empty result as empty, not an error', async () => {
      const repo = mockRepo();
      await expect(
        new OtlService(repo).timecardNotificationDetails(USER, '123864402', 'V-NFERNANDO'),
      ).resolves.toEqual({ header: null, rows: [] });
      expect(repo.getTimecardNotificationDetails).toHaveBeenCalledWith('123864402', 'V-NFERNANDO');
    });
  });
});
