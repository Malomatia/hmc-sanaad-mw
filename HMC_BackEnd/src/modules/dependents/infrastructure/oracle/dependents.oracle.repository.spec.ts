import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { DependentOracleRepository } from './dependents.oracle.repository';

function make() {
  const call = jest.fn().mockResolvedValue({ p_success_flag: 'Y', p_error_msg: null });
  const ora = { call } as unknown as OracleService;
  const schema = {
    resolveParams: jest.fn().mockResolvedValue([]),
  } as unknown as OracleSchemaService;
  return { repository: new DependentOracleRepository(ora, schema), call };
}

describe.each([
  { operation: 'add' as const, procedure: ORACLE_OBJECTS.DEPENDENT_PKG_ADD },
  { operation: 'update' as const, procedure: ORACLE_OBJECTS.DEPENDENT_PKG_UPDATE },
])('DependentOracleRepository.$operation effective date', ({ operation, procedure }) => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 8, 7, 0, 0, 0));
  });

  afterEach(() => jest.useRealTimers());

  it.each(['en', 'ar'] as const)('binds the current server date as YYYYMMDD for %s', async (lang) => {
    const { repository, call } = make();
    const fields = { p_dependent_id: '5001', p_first_name: 'Testchild' };

    await repository[operation]({ username: 'TESTUSER', lang, fields });

    expect(call).toHaveBeenCalledWith(
      expect.stringContaining(procedure),
      expect.objectContaining({
        p_user_name: 'TESTUSER',
        p_first_name: 'Testchild',
        p_effective_date: '20260907',
      }),
      {},
    );
    expect(fields).not.toHaveProperty('p_effective_date');
  });

  it('overrides an effective date passed directly to the repository', async () => {
    const { repository, call } = make();
    const fields = { p_effective_date: '20000101' };

    await repository[operation]({ username: 'TESTUSER', lang: 'en', fields });

    expect(call.mock.calls[0][1].p_effective_date).toBe('20260907');
    expect(fields.p_effective_date).toBe('20000101');
  });

  it('recomputes the date for every submission across midnight and year rollover', async () => {
    const { repository, call } = make();
    const cmd = { username: 'TESTUSER', lang: 'en' as const, fields: {} };
    jest.setSystemTime(new Date(2026, 11, 31, 23, 59, 59));
    await repository[operation](cmd);
    jest.setSystemTime(new Date(2027, 0, 1, 0, 0, 0));
    await repository[operation](cmd);

    expect(call.mock.calls[0][1].p_effective_date).toBe('20261231');
    expect(call.mock.calls[1][1].p_effective_date).toBe('20270101');
  });
});
