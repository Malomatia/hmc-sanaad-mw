import * as oracledb from 'oracledb';
import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { OracleContractCatalog } from '@core/database/oracle-contracts';
import { AnnualTicketService } from '../../application/annual-ticket.service';
import { TicketOracleRepository } from '../../infrastructure/oracle/annual-ticket.oracle.repository';
import { AnnualTicketCancelRequestDto } from './annual-ticket.dto';

const COMPOSITE =
  'Self and Family |Amir |Caroline |Jerome Amir Sami |Jolie Amir Sami | |01-SEP-2025 to 31-AUG-2026 |Cash |20920';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validate = (body: Record<string, unknown>) =>
  pipe.transform(body, { type: 'body', metatype: AnnualTicketCancelRequestDto });
/** The 400 validation messages of `body`, as one string. */
const flat = async (body: Record<string, unknown>): Promise<string> => {
  const err: unknown = await validate(body).then(
    () => new Error('expected a 400'),
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BadRequestException);
  return JSON.stringify((err as BadRequestException).getResponse());
};

/** op 72 cancel body: only the ticket id + the user's own text; the composite is refused. */
describe('AnnualTicketCancelRequestDto', () => {
  it('accepts the new body (id + reason, optional comments / voucher ref / method / attachments)', async () => {
    const body = {
      analysis_criteria_id: '71794897',
      p_reason: 'Travel plans cancelled',
      p_comments: 'Cancelling the unused ticket.',
      p_voucher_ref: 'VCH-1',
      p_repayment_method: 'Payroll Deduction',
      p_file_name1: 'a.txt',
      p_attachment1: 'dGVzdA==',
    };
    await expect(validate(body)).resolves.toMatchObject(body);
  });

  it.each(['p_annual_tkt', 'p_contractual_year', 'p_ticket_as', 'p_user_name'])(
    'rejects the old / server-owned key %s with 400 "should not exist"',
    async (key) => {
      const text = await flat({ analysis_criteria_id: '71794897', p_reason: 'R', [key]: COMPOSITE });
      expect(text).toContain(`property ${key} should not exist`);
    },
  );

  it('rejects the old five-string body', async () => {
    const text = await flat({
      p_annual_tkt: COMPOSITE,
      p_contractual_year: '01-SEP-2025 to 31-AUG-2026',
      p_reason: 'Travel plans cancelled',
      p_ticket_as: 'Cash',
      p_repayment_method: 'Payroll Deduction',
    });
    expect(text).toContain('property p_annual_tkt should not exist');
    expect(text).toContain('analysis_criteria_id must be a numeric ticket id.');
  });

  it.each(['', 'abc', '71794897 ', '7179-4897', '1e3', '1234567890123456', 71794897, null])(
    'rejects a non-digit analysis_criteria_id (%p)',
    async (id) => {
      await expect(validate({ analysis_criteria_id: id, p_reason: 'R' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );

  it('requires p_reason', async () => {
    const text = await flat({ analysis_criteria_id: '71794897' });
    expect(text).toContain('p_reason should not be empty');
  });
});

/**
 * The whole server-side path with the real repository and static catalog:
 * validated body → service lookup → CANCEL_TKT_PR binds. `p_user_name` is
 * always the JWT user's, never a body value.
 */
describe('POST /annual-ticket/cancel → CANCEL_TKT_PR binds', () => {
  afterEach(() => jest.restoreAllMocks());

  it('binds the resolved ticket values and the JWT username', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const rowsByObject: Record<string, Record<string, unknown>[]> = {
      XXHMC_SND_EMPLOYMENT_DETAILS_V: [{ PERSON_ID: 26023 }],
      XXHMC_SND_CANCEL_TICKETS_V: [
        { PERSON_ID: 26023, ANALYSIS_CRITERIA_ID: 71794897, ANNUAL_LEAVE_PASS_TKT_VALUE: COMPOSITE },
      ],
      XXHMC_SND_CANCEL_TAKENAS_V: [{ PERSON_ID: 26023, ANALYSIS_CRITERIA_ID: 71794897, TAKES_AS: 'Cash' }],
      XXHMC_SND_CANCEL_REPAYMENT_METHODS_V: [
        { PERSON_ID: 26023, ANALYSIS_CRITERIA_ID: 71794897, FLEX_VALUE: 'Payroll Deduction', DESCRIPTION: 'Cash' },
      ],
    };
    const query = jest.fn((sql: string) => Promise.resolve(rowsByObject[String(sql).split(' ')[3]] ?? []));
    const call = jest
      .fn()
      .mockResolvedValue({ p_success_flag: 'S', p_error_msg: null, p_error_msg_ar: null });
    const ora = { query, call } as unknown as OracleService;
    const repo = new TicketOracleRepository(ora, new OracleSchemaService(new OracleContractCatalog()));
    const service = new AnnualTicketService(repo);

    const body = await validate({ analysis_criteria_id: '71794897', p_reason: 'Travel plans cancelled' });
    await service.cancel(body, { username: 'aibrahim39', roles: [] }, 'en');

    expect(call).toHaveBeenCalledTimes(1);
    const [sql, binds] = call.mock.calls[0] as [string, Record<string, unknown>];
    expect(sql).toContain('XXHMC_SND_CANCEL_TKT_PR');
    expect(binds).toMatchObject({
      p_user_name: 'AIBRAHIM39',
      p_annual_tkt: '71794897',
      p_contractual_year: '01-SEP-2025 to 31-AUG-2026',
      p_reason: 'Travel plans cancelled',
      p_ticket_as: 'Cash',
      p_repayment_method: 'Payroll Deduction',
    });
    expect(binds.p_attachment1).toEqual({ type: oracledb.DB_TYPE_BLOB, val: null });
  });
});
