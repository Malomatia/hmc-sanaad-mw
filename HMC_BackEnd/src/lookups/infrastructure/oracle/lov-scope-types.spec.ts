import { ConfigService } from '@nestjs/config';
import { LovOracleRepository } from './lov.oracle.repository';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';

/**
 * scopeAlternatives sends EVERY identifier the caller supplied so the client
 * need not know which form a view keys on. Against a numeric column that
 * backfired: Oracle coerces the other side of the comparison, so one username
 * in `person_id IN (...)` raises ORA-01722 and loses the whole predicate —
 * `?person_id=26023&username=AIBRAHIM39` answered 0 rows where
 * `?person_id=26023` alone answered 15. Sending more identifiers made the
 * result strictly worse.
 *
 * These cases pin both halves: incompatible values are dropped, and the call
 * the mobile app already makes is untouched.
 */
describe('LOV scoping against a typed key column', () => {
  const PERSON = '26023';
  const USERNAME = 'AIBRAHIM39';
  const EMPLOYEE = '037400';

  const CANCEL_V = ORACLE_OBJECTS.LEAVE_CANCEL_V;
  const AMEND_V = ORACLE_OBJECTS.LEAVE_AMEND_V;

  function make(keyColumn: string, numeric: boolean) {
    const query = jest.fn().mockResolvedValue([]);
    const ora = { query } as unknown as OracleService;
    const schema = {
      hasColumn: jest.fn(async (_o: string, c: string) => c === keyColumn),
      isNumericColumn: jest.fn(async () => numeric),
      resolveKeyColumn: jest.fn(async () => keyColumn),
    } as unknown as OracleSchemaService;
    // no LOV cache, so each case issues its own query
    const config = { get: jest.fn(() => 0) } as unknown as ConfigService;
    return { repo: new LovOracleRepository(ora, schema, config), query };
  }

  /** The SQL text and binds of the single query the repository issued. */
  const issued = (query: jest.Mock) => ({
    sql: String(query.mock.calls[0][0]).replace(/\s+/g, ' '),
    binds: query.mock.calls[0][1] as Record<string, unknown>,
  });

  it('keeps the call the app already makes working', async () => {
    const { repo, query } = make('person_id', true);

    await repo.readLov(CANCEL_V, 'en', PERSON, {});

    const { sql, binds } = issued(query);
    expect(sql).toContain('person_id IN (:u0)');
    expect(binds).toEqual({ u0: PERSON });
  });

  it('drops non-numeric identifiers rather than poisoning the IN-list', async () => {
    const { repo, query } = make('person_id', true);

    await repo.readLov(CANCEL_V, 'en', PERSON, {
      scopeAlternatives: [USERNAME, EMPLOYEE],
    });

    const { sql, binds } = issued(query);
    // 037400 is digits, so it survives; the username cannot match a NUMBER
    expect(sql).toContain('person_id IN (:u0, :u1)');
    expect(Object.values(binds)).toEqual([PERSON, EMPLOYEE]);
    expect(Object.values(binds)).not.toContain(USERNAME);
  });

  it('leaves a text key column alone — every form can match there', async () => {
    const { repo, query } = make('user_name', false);

    await repo.readLov(AMEND_V, 'en', USERNAME, {
      scopeAlternatives: [PERSON, EMPLOYEE],
    });

    const { sql, binds } = issued(query);
    expect(sql).toContain('user_name IN (:u0, :u1, :u2)');
    expect(Object.values(binds)).toEqual([USERNAME, PERSON, EMPLOYEE]);
  });

  it('reads the whole view when nothing numeric was supplied', async () => {
    const { repo, query } = make('person_id', true);

    await repo.readLov(CANCEL_V, 'en', USERNAME, {});

    // no usable identifier => no scope predicate, rather than a query that
    // Oracle would reject outright
    expect(issued(query).sql).not.toContain('IN (');
  });
});
