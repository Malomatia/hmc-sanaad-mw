import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { PayslipOracleRepository } from './payslip.oracle.repository';

/**
 * The period cursors carry PERIOD_NAME + PERIOD_NAME_AR, and the
 * ResponseInterceptor collapses the pair — so on `lang=ar` the PERIOD_NAME
 * field itself holds Arabic. A client echoing what it displayed would send
 * Arabic back into `payperiod`, which the payslip procedures cannot match.
 * `used_value` is the stable value to return, captured before localization.
 */
describe('PayslipOracleRepository — used_value for the period', () => {
  function make(rows: Record<string, unknown>[]) {
    const ora = { callCursor: jest.fn().mockResolvedValue(rows) } as unknown as OracleService;
    const schema = {
      resolveParams: jest.fn().mockResolvedValue([]),
      resolveCursorParam: jest.fn().mockResolvedValue(undefined),
    } as unknown as OracleSchemaService;
    return new PayslipOracleRepository(ora, schema);
  }

  const ROW = {
    PERIOD_NAME: 'January 2026',
    PERIOD_NAME_AR: 'يناير  2026',
    TIT: 4061,
    PERSON_ID: 26023,
  };

  it('exposes the English period name as used_value', async () => {
    const [row] = await make([ROW]).getPeriods('AIBRAHIM39', 'en');

    expect(row.used_value).toBe('January 2026');
    // the original fields are untouched — the client still displays PERIOD_NAME
    expect(row.PERIOD_NAME).toBe('January 2026');
    expect(row.TIT).toBe(4061);
  });

  it('keeps used_value English even when the caller asked for Arabic', async () => {
    const [row] = await make([ROW]).getPeriods('AIBRAHIM39', 'ar');

    expect(row.used_value).toBe('January 2026');
  });

  it('trims the padding some period names carry', async () => {
    const [row] = await make([{ PERIOD_NAME: '  March 2026 ' }]).getPeriods('AIBRAHIM39', 'en');

    expect(row.used_value).toBe('March 2026');
  });

  it('adds it to the payslip-count rows too', async () => {
    const { rows } = await make([ROW]).checkCount('26023', 'ar', 'January 2026');

    expect(rows[0].used_value).toBe('January 2026');
  });

  it('leaves a row without a period name alone', async () => {
    const [row] = await make([{ TIT: 1 }]).getPeriods('AIBRAHIM39', 'en');

    expect(row).not.toHaveProperty('used_value');
  });
});

describe('PayslipOracleRepository.generate error messages', () => {
  it.each([
    ['ORA-01403: no data found\nORA-06512: at line 4', 'no data found'],
    ['ORA-00942: SELECT secret FROM accounts', 'The database request failed.'],
    ['  Payslip unavailable  ', 'Payslip unavailable'],
    [null, null],
    [undefined, undefined],
  ])('cleans Oracle errors without changing empty messages: %s', async (raw, expected) => {
    const ora = {
      callMultiCursor: jest.fn().mockResolvedValue({
        cursors: {},
        scalars: { p_success_flag: 'N', p_error_msg: raw },
      }),
    } as unknown as OracleService;
    const schema = { resolveParams: jest.fn().mockResolvedValue([]) } as unknown as OracleSchemaService;
    const repository = new PayslipOracleRepository(ora, schema);

    const result = await repository.generate({
      personId: '123',
      lang: 'en',
      payPeriod: 'September 2026',
      assignmentId: '456',
    });

    expect(result.errorMessage).toBe(expected);
    expect(result.successFlag).toBe('N');
  });
});
