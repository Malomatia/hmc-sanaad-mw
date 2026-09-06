import { ApprovalsOracleRepository } from './approvals.oracle.repository';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';

/**
 * MY_REQEST_SUMMARY_V and APPROVE_SUMRY_V store the employee NUMBER, while
 * PNDNG_QID_V stores the login, so both forms have to reach the views.
 *
 * The JWT only carries the login — `identity.employeeNumber` is not populated
 * at login — so when ops 20/23 stopped trusting a client-supplied `?enum=`
 * (an employee could otherwise read another's rows), the employee-number form
 * disappeared and op 23 answered 0 rows for a caller with 8 in the view. The
 * number is resolved from the same view op 2 reads instead, which keeps it the
 * caller's own identity.
 */
describe('approvals key scoping', () => {
  const USERNAME = 'AIBRAHIM39';
  const EMPLOYEE = '037400';

  // `null` rather than `undefined` for "no row": passing undefined would
  // trigger the default parameter and quietly test the opposite case.
  function make(personalRow: Record<string, unknown> | null = { EMPLOYEE_NUMBER: EMPLOYEE }) {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes(ORACLE_OBJECTS.PERSONAL_DETAILS_V)) return personalRow ? [personalRow] : [];
      return [];
    });
    const ora = { query } as unknown as OracleService;
    const schema = {
      resolveKeyColumn: jest.fn(async (_o: string, candidates: readonly string[]) => candidates[0]),
    } as unknown as OracleSchemaService;
    // the cache is static, so each case needs its own username
    return { repo: new ApprovalsOracleRepository(ora, schema), query };
  }

  /** Binds of the query issued against `object`. */
  const bindsFor = (query: jest.Mock, object: string) => {
    const call = query.mock.calls.find((c) => String(c[0]).includes(object));
    return call ? Object.values(call[1] as Record<string, unknown>) : undefined;
  };

  it('adds the resolved employee number so the requestor view matches', async () => {
    const { repo, query } = make();

    await repo.getMyRequests([`${USERNAME}-A`], 'en');

    expect(bindsFor(query, ORACLE_OBJECTS.MY_REQEST_SUMMARY_V)).toEqual([
      `${USERNAME}-A`,
      EMPLOYEE,
    ]);
  });

  it('does the same for the approver view', async () => {
    const { repo, query } = make();

    await repo.getSummary([`${USERNAME}-B`], 'en');

    expect(bindsFor(query, ORACLE_OBJECTS.APPROVE_SUMRY_V)).toEqual([
      `${USERNAME}-B`,
      EMPLOYEE,
    ]);
  });

  it('still queries with the login alone when the number cannot be resolved', async () => {
    const { repo, query } = make(null);

    await repo.getMyRequests([`${USERNAME}-C`], 'en');

    expect(bindsFor(query, ORACLE_OBJECTS.MY_REQEST_SUMMARY_V)).toEqual([`${USERNAME}-C`]);
  });

  it('reads the mapping once per caller, not once per request', async () => {
    const { repo, query } = make();

    await repo.getMyRequests([`${USERNAME}-D`], 'en');
    await repo.getMyRequests([`${USERNAME}-D`], 'en');

    const lookups = query.mock.calls.filter((c) =>
      String(c[0]).includes(ORACLE_OBJECTS.PERSONAL_DETAILS_V),
    );
    expect(lookups).toHaveLength(1);
  });
});
