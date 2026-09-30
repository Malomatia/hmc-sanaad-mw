import { BadRequestException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { TicketCancelOptionRows, TicketRepository } from '../domain/annual-ticket.repository';
import { AnnualTicketService } from './annual-ticket.service';

const USER: AuthenticatedUser = { username: 'AIBRAHIM39', roles: [] };

const year = (from: number) => `01-SEP-${from} to 31-AUG-${from + 1}`;

/**
 * The 12 TICKET_MASTER rows of AIBRAHIM39 (EBSDEV/EBSPRJ 2026-09-29), columns
 * as Oracle returns them, in view order (the Self passenger is NOT first).
 */
const MASTER_ROWS: Record<string, unknown>[] = [
  ...[2025, 2026, 2027].map((from, i) => ({
    TAG1: 'CONTRACTUAL YEAR',
    RECORD_TYPE: 'CONTRACT',
    PERSON_ID: 26023,
    USER_NAME: 'AIBRAHIM39',
    NAME_EN: year(from),
    NAME_AR: `${year(from)} (ar)`,
    CONTRACT_YEAR: year(from),
    CONTRACT_YEAR_DEF: year(from),
    CONTRACT_YEAR_DEF_AR: `${year(from)} (ar)`,
    LAW: 'HMC LAW',
    TOT_COUNT: 18,
    FROM_DATE: from,
    TOO_DATE: from + 1,
    ROW_NUM: i + 1,
  })),
  { TAG1: 'DESTINATION', RECORD_TYPE: 'DESTINATION', PERSON_ID: 26023, NAME_EN: 'Cairo', NAME_AR: 'القاهرة' },
  {
    TAG1: 'PASSENGER',
    RECORD_TYPE: 'Family',
    PERSON_ID: 26023,
    CONTACT_ID: 42465,
    NAME_EN: 'Caroline Victor Francis Fam',
    NAME_AR: 'كارولين',
    CONTACT_TYPE: 'S',
    CURRENT_EMPLOYEE_FLAG: null,
    DATE_OF_BIRTH: null,
    SEX: 'F',
  },
  {
    TAG1: 'PASSENGER',
    RECORD_TYPE: 'Self',
    PERSON_ID: 26023,
    CONTACT_ID: 26023,
    NAME_EN: 'Mr. Amir Sami Samir Ibrahim',
    NAME_AR: 'امير',
    CONTACT_TYPE: 'EMP',
    CURRENT_EMPLOYEE_FLAG: 'Y',
    DATE_OF_BIRTH: new Date(1984, 4, 15),
    SEX: 'M',
  },
  ...[
    [329302, 'Jerome Amir Sami Samir Ibrahim', 'M'],
    [329303, 'Jolie Amir Sami Samir Ibrahim', 'F'],
  ].map(([id, name, sex]) => ({
    TAG1: 'PASSENGER',
    RECORD_TYPE: 'Family',
    PERSON_ID: 26023,
    CONTACT_ID: id,
    NAME_EN: name,
    NAME_AR: null,
    CONTACT_TYPE: 'C',
    CURRENT_EMPLOYEE_FLAG: null,
    DATE_OF_BIRTH: null,
    SEX: sex,
  })),
  { TAG1: 'REQUEST FOR', RECORD_TYPE: 'REQUEST_TYPE', NAME_EN: 'Family', NAME_AR: 'العائلة' },
  { TAG1: 'REQUEST FOR', RECORD_TYPE: 'REQUEST_TYPE', NAME_EN: 'Self', NAME_AR: 'الموظف' },
  { TAG1: 'REQUEST FOR', RECORD_TYPE: 'REQUEST_TYPE', NAME_EN: 'Self and Family', NAME_AR: 'الموظف و العائلة' },
  { TAG1: 'TICKET CLASS', RECORD_TYPE: 'TICKET_CLASS', NAME_EN: 'Economy', NAME_AR: 'إقتصادية' },
];

const COMPOSITE_2025 =
  'Self and Family |Amir |Caroline |Jerome Amir Sami |Jolie Amir Sami | |01-SEP-2025 to 31-AUG-2026 |Cash |20920';
const COMPOSITE_2024 =
  'Self and Family |Amir |Caroline |Jerome Amir Sami |Jolie Amir Sami | |01-SEP-2024 to 31-AUG-2025 |Cash |20920';

/**
 * Raw cancel views for PERSON_ID 26023 as seen on staging: 2 tickets, but
 * TAKENAS_V / REPAYMENT_METHODS_V carry one row per HISTORICAL ticket.
 */
const RAW_OPTIONS: TicketCancelOptionRows = {
  tickets: [
    { PERSON_ID: 26023, ANALYSIS_CRITERIA_ID: 71794897, ANNUAL_LEAVE_PASS_TKT_VALUE: COMPOSITE_2025 },
    { PERSON_ID: 26023, ANALYSIS_CRITERIA_ID: 71803898, ANNUAL_LEAVE_PASS_TKT_VALUE: COMPOSITE_2024 },
  ],
  takenAs: [
    { PERSON_ID: 26023, ANALYSIS_CRITERIA_ID: 70000001, TAKES_AS: 'Voucher', TAKEN_AS_AR: 'قسيمة' },
    { PERSON_ID: 26023, ANALYSIS_CRITERIA_ID: 71794897, TAKES_AS: 'Cash', TAKEN_AS_AR: 'نقدا' },
    { PERSON_ID: 26023, ANALYSIS_CRITERIA_ID: 71803898, TAKES_AS: 'Cash', TAKEN_AS_AR: 'نقدا' },
    { PERSON_ID: 26023, ANALYSIS_CRITERIA_ID: 70000002, TAKES_AS: 'Cash', TAKEN_AS_AR: 'نقدا' },
  ],
  repaymentMethods: [
    { PERSON_ID: 26023, ANALYSIS_CRITERIA_ID: 70000001, FLEX_VALUE: 'Cancel Voucher', DESCRIPTION: 'Voucher', FLEX_VALUE_AR: 'إلغاء القسيمة' },
    { PERSON_ID: 26023, ANALYSIS_CRITERIA_ID: 71794897, FLEX_VALUE: 'Payroll Deduction', DESCRIPTION: 'Cash', FLEX_VALUE_AR: 'خصم من الراتب' },
    { PERSON_ID: 26023, ANALYSIS_CRITERIA_ID: 70000002, FLEX_VALUE: 'Payroll Deduction', DESCRIPTION: 'Cash', FLEX_VALUE_AR: 'خصم من الراتب' },
  ],
};

function makeService(overrides: Partial<jest.Mocked<TicketRepository>> = {}) {
  const repo = {
    apply: jest.fn(),
    cancel: jest.fn().mockResolvedValue({ successflag: 'S' }),
    cancelOptions: jest.fn().mockResolvedValue(RAW_OPTIONS),
    resolvePersonId: jest.fn().mockResolvedValue('26023'),
    getMaster: jest.fn().mockResolvedValue(MASTER_ROWS),
    getEligibility: jest.fn().mockResolvedValue({ eligible: 'Yes', eligibleAr: 'نعم' }),
    ...overrides,
  } as jest.Mocked<TicketRepository>;
  return { service: new AnnualTicketService(repo), repo };
}

/**
 * op 66 master: TICKET_MASTER of the JWT caller grouped by TAG1, each item's
 * `value` / `contactId` being what op 67 expects, plus the ANNUAL_TICKT_LOV flag.
 */
describe('AnnualTicketService.master', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('groups the 12 real rows of AIBRAHIM39 into the five pickers, Self passenger first', async () => {
    const { service, repo } = makeService();

    const master = await service.master(USER);

    expect(repo.getMaster).toHaveBeenCalledWith('AIBRAHIM39');
    expect(repo.getEligibility).toHaveBeenCalledWith('AIBRAHIM39');
    expect(repo.resolvePersonId).not.toHaveBeenCalled();
    expect(master).toEqual({
      eligible: 'Yes',
      eligibleAr: 'نعم',
      contractualYears: [2025, 2026, 2027].map((from) => ({
        value: year(from),
        label: year(from),
        labelAr: `${year(from)} (ar)`,
        fromYear: from,
        toYear: from + 1,
        law: 'HMC LAW',
        totalCount: 18,
      })),
      destinations: [{ value: 'Cairo', label: 'Cairo', labelAr: 'القاهرة' }],
      passengers: [
        {
          contactId: '26023',
          name: 'Mr. Amir Sami Samir Ibrahim',
          nameAr: 'امير',
          type: 'Self',
          contactType: 'EMP',
          currentEmployee: 'Y',
          dateOfBirth: '1984-05-15',
          sex: 'M',
        },
        {
          contactId: '42465',
          name: 'Caroline Victor Francis Fam',
          nameAr: 'كارولين',
          type: 'Family',
          contactType: 'S',
          currentEmployee: null,
          dateOfBirth: null,
          sex: 'F',
        },
        expect.objectContaining({ contactId: '329302', type: 'Family', contactType: 'C' }),
        expect.objectContaining({ contactId: '329303', type: 'Family', contactType: 'C' }),
      ],
      requestFor: [
        { value: 'Family', label: 'Family', labelAr: 'العائلة' },
        { value: 'Self', label: 'Self', labelAr: 'الموظف' },
        { value: 'Self and Family', label: 'Self and Family', labelAr: 'الموظف و العائلة' },
      ],
      ticketClasses: [{ value: 'Economy', label: 'Economy', labelAr: 'إقتصادية' }],
      requestType: 'Annual Ticket',
      other: [],
    });
  });

  it('takes the contractual-year value from CONTRACT_YEAR and falls back for the label', async () => {
    const { service } = makeService({
      getMaster: jest.fn().mockResolvedValue([
        {
          TAG1: 'CONTRACTUAL YEAR',
          NAME_EN: '01-SEP-2025 to 31-AUG-2026 (current)',
          NAME_AR: 'ar name',
          CONTRACT_YEAR: '01-SEP-2025 to 31-AUG-2026',
          CONTRACT_YEAR_DEF: null,
          CONTRACT_YEAR_DEF_AR: null,
        },
      ]),
    });

    const [contract] = (await service.master(USER)).contractualYears;

    expect(contract).toMatchObject({
      value: '01-SEP-2025 to 31-AUG-2026',
      label: '01-SEP-2025 to 31-AUG-2026 (current)',
      labelAr: 'ar name',
    });
  });

  it('keeps unknown TAG1 rows in `other` (tolerating case/space in known tags)', async () => {
    const { service } = makeService({
      getMaster: jest.fn().mockResolvedValue([
        { TAG1: ' destination ', NAME_EN: 'Doha', NAME_AR: null },
        { TAG1: 'VISA TYPE', RECORD_TYPE: 'VISA', NAME_EN: 'Exit', NAME_AR: 'خروج', ROW_NUM: 9 },
        { TAG1: null, NAME_EN: 'Untagged' },
      ]),
    });

    const master = await service.master(USER);

    expect(master.destinations).toEqual([{ value: 'Doha', label: 'Doha', labelAr: null }]);
    expect(master.other).toEqual([
      { tag: 'VISA TYPE', recordType: 'VISA', value: 'Exit', label: 'Exit', labelAr: 'خروج' },
      { tag: null, recordType: null, value: 'Untagged', label: 'Untagged', labelAr: null },
    ]);
  });

  it('drops rows identical apart from ROW_NUM', async () => {
    const economy = { TAG1: 'TICKET CLASS', NAME_EN: 'Economy', NAME_AR: 'إقتصادية' };
    const { service } = makeService({
      getMaster: jest.fn().mockResolvedValue([
        { ...economy, ROW_NUM: 1 },
        { ...economy, ROW_NUM: 2 },
        { ...economy, NAME_EN: 'Business', ROW_NUM: 3 },
      ]),
    });

    const { ticketClasses } = await service.master(USER);

    expect(ticketClasses.map((c) => c.value)).toEqual(['Economy', 'Business']);
  });

  it.each([
    ['answers null', () => jest.fn().mockResolvedValue(null)],
    ['rejects unexpectedly', () => jest.fn().mockRejectedValue(new Error('ORA-00942'))],
  ])('still answers with eligible: null when the flag read %s', async (_, getEligibility) => {
    const { service } = makeService({ getEligibility: getEligibility() });

    const master = await service.master(USER);

    expect(master).toMatchObject({ eligible: null, eligibleAr: null });
    expect(master.passengers).toHaveLength(4);
  });

  it('logs the unexpected eligibility rejection', async () => {
    const { service } = makeService({
      getEligibility: jest.fn().mockRejectedValue(new Error('ORA-00942')),
    });

    await service.master(USER);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ANNUAL_TICKT_LOV'));
  });

  it('propagates a TICKET_MASTER failure (it is the payload, not a side read)', async () => {
    const { service } = makeService({ getMaster: jest.fn().mockRejectedValue(new Error('ORA-03156')) });

    await expect(service.master(USER)).rejects.toThrow('ORA-03156');
  });

  it.each(['26023', ' 26023 ', '026023'])(
    "accepts a client person_id equal to the caller's own (%p) without an extra read",
    async (personId) => {
      const { service, repo } = makeService();

      await expect(service.master(USER, { person_id: personId })).resolves.toMatchObject({
        eligible: 'Yes',
      });
      expect(repo.resolvePersonId).not.toHaveBeenCalled();
    },
  );

  it.each(['42465', '26024', 'abc', '26023 OR 1=1'])(
    "refuses a client person_id that is not the caller's (%p) with 403",
    async (personId) => {
      const { service } = makeService();

      await expect(service.master(USER, { person_id: personId })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    },
  );

  it('falls back to EMPLOYMENT_DETAILS_V when the master rows carry no PERSON_ID', async () => {
    const { service, repo } = makeService({ getMaster: jest.fn().mockResolvedValue([]) });

    await expect(service.master(USER, { person_id: '26024' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.resolvePersonId).toHaveBeenCalledWith('AIBRAHIM39');
    await expect(service.master(USER, { person_id: '26023' })).resolves.toMatchObject({
      contractualYears: [],
      destinations: [],
      passengers: [],
      requestFor: [],
      ticketClasses: [],
      requestType: 'Annual Ticket',
      other: [],
    });
  });
});

/**
 * op 72 cancel-options is bound to the JWT caller (SEC-02 d) and joins the
 * three views on ANALYSIS_CRITERIA_ID: one entry per ticket with its own
 * taken-as and repayment methods; the legacy flat lists are deduplicated.
 */
describe('AnnualTicketService.cancelOptions', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('joins the three views per ticket on ANALYSIS_CRITERIA_ID and dedups the flat lists', async () => {
    const { service, repo } = makeService();

    await expect(service.cancelOptions(USER, {})).resolves.toEqual({
      tickets: [
        {
          analysisCriteriaId: '71794897',
          value: COMPOSITE_2025,
          requestFor: 'Self and Family',
          employeeName: 'Amir',
          passengers: ['Caroline', 'Jerome Amir Sami', 'Jolie Amir Sami'],
          contractualYear: '01-SEP-2025 to 31-AUG-2026',
          takenAs: 'Cash',
          takenAsAr: 'نقدا',
          amount: '20920',
          repaymentMethods: [
            { value: 'Payroll Deduction', label: 'Payroll Deduction', labelAr: 'خصم من الراتب', appliesTo: 'Cash' },
          ],
        },
        {
          analysisCriteriaId: '71803898',
          value: COMPOSITE_2024,
          requestFor: 'Self and Family',
          employeeName: 'Amir',
          passengers: ['Caroline', 'Jerome Amir Sami', 'Jolie Amir Sami'],
          contractualYear: '01-SEP-2024 to 31-AUG-2025',
          takenAs: 'Cash',
          takenAsAr: 'نقدا',
          amount: '20920',
          repaymentMethods: [],
        },
      ],
      takenAs: [
        { TAKES_AS: 'Voucher', TAKEN_AS_AR: 'قسيمة' },
        { TAKES_AS: 'Cash', TAKEN_AS_AR: 'نقدا' },
      ],
      repaymentMethods: [
        { FLEX_VALUE: 'Cancel Voucher', DESCRIPTION: 'Voucher', FLEX_VALUE_AR: 'إلغاء القسيمة' },
        { FLEX_VALUE: 'Payroll Deduction', DESCRIPTION: 'Cash', FLEX_VALUE_AR: 'خصم من الراتب' },
      ],
    });

    expect(repo.resolvePersonId).toHaveBeenCalledWith('AIBRAHIM39');
    expect(repo.cancelOptions).toHaveBeenCalledTimes(1);
    expect(repo.cancelOptions).toHaveBeenCalledWith('26023');
  });

  it('falls back to composite segment 7 when TAKENAS_V has no row for the ticket', async () => {
    const { service } = makeService({
      cancelOptions: jest.fn().mockResolvedValue({
        tickets: [{ ANALYSIS_CRITERIA_ID: '71794897', ANNUAL_LEAVE_PASS_TKT_VALUE: COMPOSITE_2025 }],
        takenAs: [],
        repaymentMethods: [],
      }),
    });

    const [ticket] = (await service.cancelOptions(USER)).tickets;

    expect(ticket).toMatchObject({ takenAs: 'Cash', takenAsAr: null, repaymentMethods: [] });
  });

  it('skips ticket rows without an id or value, and repeated ids', async () => {
    const { service } = makeService({
      cancelOptions: jest.fn().mockResolvedValue({
        tickets: [
          { ANALYSIS_CRITERIA_ID: null, ANNUAL_LEAVE_PASS_TKT_VALUE: COMPOSITE_2025 },
          { ANALYSIS_CRITERIA_ID: 71794897, ANNUAL_LEAVE_PASS_TKT_VALUE: null },
          { ANALYSIS_CRITERIA_ID: 71803898, ANNUAL_LEAVE_PASS_TKT_VALUE: COMPOSITE_2024 },
          { ANALYSIS_CRITERIA_ID: 71803898, ANNUAL_LEAVE_PASS_TKT_VALUE: COMPOSITE_2025 },
        ],
        takenAs: [],
        repaymentMethods: [],
      }),
    });

    const { tickets } = await service.cancelOptions(USER);

    expect(tickets.map((t) => [t.analysisCriteriaId, t.value])).toEqual([['71803898', COMPOSITE_2024]]);
  });

  it.each(['26023', ' 26023 ', '026023'])(
    "accepts a client person_id equal to the caller's own (%p)",
    async (personId) => {
      const { service, repo } = makeService();

      await service.cancelOptions(USER, { person_id: personId });

      expect(repo.cancelOptions).toHaveBeenCalledWith('26023');
    },
  );

  it.each(['26024', 'abc', '26023 OR 1=1'])(
    "refuses a client person_id that is not the caller's (%p) with 403 and reads no view",
    async (personId) => {
      const { service, repo } = makeService();

      await expect(service.cancelOptions(USER, { person_id: personId })).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      expect(repo.cancelOptions).not.toHaveBeenCalled();
    },
  );

  it('returns empty lists and reads no view when the caller has no PERSON_ID', async () => {
    const { service, repo } = makeService({ resolvePersonId: jest.fn().mockResolvedValue(null) });
    const warn = jest.spyOn(Logger.prototype, 'warn');

    await expect(service.cancelOptions(USER, { person_id: '26023' })).resolves.toEqual({
      tickets: [],
      takenAs: [],
      repaymentMethods: [],
    });

    expect(repo.cancelOptions).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });
});

/**
 * op 72 cancel: the client names the ticket by ANALYSIS_CRITERIA_ID only and
 * every CANCEL_TKT_PR list value is resolved from the caller's own options.
 */
describe('AnnualTicketService.cancel', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('resolves every p_* value server-side from the ticket (p_annual_tkt = its id, never the 109-char composite) and passes the user text through', async () => {
    const { service, repo } = makeService();

    await expect(
      service.cancel(
        {
          analysis_criteria_id: '71794897',
          p_reason: 'Travel plans cancelled',
          p_comments: 'Cancelling the unused ticket.',
          p_voucher_ref: 'VCH-1',
          p_file_name1: 'a.txt',
          p_attachment1: 'dGVzdA==',
        },
        USER,
        'en',
      ),
    ).resolves.toEqual({ successflag: 'S' });

    expect(repo.resolvePersonId).toHaveBeenCalledWith('AIBRAHIM39');
    expect(repo.cancel).toHaveBeenCalledWith({
      username: 'AIBRAHIM39',
      lang: 'en',
      fields: {
        p_annual_tkt: '71794897',
        p_contractual_year: '01-SEP-2025 to 31-AUG-2026',
        p_ticket_as: 'Cash',
        p_repayment_method: 'Payroll Deduction',
        p_reason: 'Travel plans cancelled',
        p_comments: 'Cancelling the unused ticket.',
        p_voucher_ref: 'VCH-1',
        p_file_name1: 'a.txt',
        p_attachment1: 'dGVzdA==',
      },
    });
  });

  it('accepts an explicit repayment method case-insensitively and submits Oracle spelling', async () => {
    const { service, repo } = makeService();

    await service.cancel(
      { analysis_criteria_id: '071794897', p_reason: 'R', p_repayment_method: ' payroll deduction ' },
      USER,
      'ar',
    );

    expect(repo.cancel.mock.calls[0][0].fields).toMatchObject({
      p_annual_tkt: '71794897',
      p_repayment_method: 'Payroll Deduction',
    });
  });

  it.each(['99999999', '71794898', ''])(
    'answers 404 for an id that is not one of the caller\'s tickets (%p) and submits nothing',
    async (id) => {
      const { service, repo } = makeService();

      await expect(
        service.cancel({ analysis_criteria_id: id, p_reason: 'R' }, USER, 'en'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.cancel).not.toHaveBeenCalled();
    },
  );

  it('answers 404 when the caller has no PERSON_ID (no ticket can be theirs)', async () => {
    const { service, repo } = makeService({ resolvePersonId: jest.fn().mockResolvedValue(null) });

    await expect(
      service.cancel({ analysis_criteria_id: '71794897', p_reason: 'R' }, USER, 'en'),
    ).rejects.toThrow('Ticket not found or not cancellable for this user.');
    expect(repo.cancelOptions).not.toHaveBeenCalled();
    expect(repo.cancel).not.toHaveBeenCalled();
  });

  it('answers 400 asking to choose when the ticket has several methods and none is sent', async () => {
    const { service, repo } = makeService({
      cancelOptions: jest.fn().mockResolvedValue({
        ...RAW_OPTIONS,
        repaymentMethods: [
          ...RAW_OPTIONS.repaymentMethods,
          { ANALYSIS_CRITERIA_ID: 71794897, FLEX_VALUE: 'Cancel Voucher', DESCRIPTION: 'Voucher' },
        ],
      }),
    });

    const attempt = service.cancel({ analysis_criteria_id: '71794897', p_reason: 'R' }, USER, 'en');

    await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt).rejects.toThrow(/send p_repayment_method to choose one/);
    expect(repo.cancel).not.toHaveBeenCalled();
  });

  it('answers 400 when the ticket has no repayment method and none is sent', async () => {
    const { service, repo } = makeService();

    await expect(
      service.cancel({ analysis_criteria_id: '71803898', p_reason: 'R' }, USER, 'en'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.cancel).not.toHaveBeenCalled();
  });

  it.each(['Cancel Voucher', 'Cash'])(
    "answers 400 for a repayment method that is not the ticket's own (%p)",
    async (method) => {
      const { service, repo } = makeService();

      await expect(
        service.cancel(
          { analysis_criteria_id: '71794897', p_reason: 'R', p_repayment_method: method },
          USER,
          'en',
        ),
      ).rejects.toThrow("p_repayment_method must be one of this ticket's repayment methods: Payroll Deduction.");
      expect(repo.cancel).not.toHaveBeenCalled();
    },
  );

  it('never lets the body override a server-resolved value', async () => {
    const { service, repo } = makeService();

    await service.cancel(
      {
        analysis_criteria_id: '71794897',
        p_reason: 'R',
        p_annual_tkt: 'forged',
        p_contractual_year: 'forged',
        p_ticket_as: 'Voucher',
      },
      USER,
      'en',
    );

    expect(repo.cancel.mock.calls[0][0].fields).toMatchObject({
      p_annual_tkt: '71794897',
      p_contractual_year: '01-SEP-2025 to 31-AUG-2026',
      p_ticket_as: 'Cash',
    });
    expect(repo.cancel.mock.calls[0][0].fields).not.toHaveProperty('analysis_criteria_id');
    expect(repo.cancel.mock.calls[0][0].fields.p_annual_tkt).not.toBe(COMPOSITE_2025);
  });
});
