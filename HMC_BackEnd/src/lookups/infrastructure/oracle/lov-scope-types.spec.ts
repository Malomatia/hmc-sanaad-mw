import { ConfigService } from '@nestjs/config';
import { LovOracleRepository } from './lov.oracle.repository';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { CallerIdentity } from '@shared/domain/caller-identity';
import { MissingIdentityClaimException } from '@core/auth/current-identity';
import { OracleMetadataService } from '@core/database/oracle-metadata.service';
import { LookupsService } from '@lookups/application/lookups.service';
import { LovReadOptions } from '@lookups/domain/lov.repository';
import { LeaveService } from '@modules/leave/application/leave.service';
import { LeaveRepository } from '@modules/leave/domain/leave.repository';
import { LettersService } from '@modules/letters/application/letters.service';
import { LetterRepository } from '@modules/letters/domain/letters.repository';
import { SchoolFeeService } from '@modules/school-fees/application/school-fees.service';
import { SchoolFeeRepository } from '@modules/school-fees/domain/school-fees.repository';

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

describe('strict caller-scoped LOV reads', () => {
  const alice: CallerIdentity = { username: 'alice', employeeNumber: '00017', personId: '9801' };
  const bob: CallerIdentity = { username: 'bob', employeeNumber: '09801', personId: '17' };

  function make(columns: string[] = ['USER_NAME', 'NAME']) {
    const describeColumns = jest.fn().mockResolvedValue(
      columns.map((name) => ({ name, dataType: name === 'NAME' ? 'VARCHAR2' : 'NUMBER' })),
    );
    const schema = new OracleSchemaService({ describeColumns } as unknown as OracleMetadataService);
    const query = jest.fn().mockImplementation(async (_sql: string, binds: Record<string, string>) => [
      { NAME: binds.username ?? binds.employeeNumber ?? binds.personId ?? 'Global' },
    ]);
    const config = { get: jest.fn(() => 300000) } as unknown as ConfigService;
    const repo = new LovOracleRepository({ query } as unknown as OracleService, schema, config);
    return { repo, service: new LookupsService(repo), query, describeColumns, schema };
  }

  it.each([
    ['USER_NAME', 'username', 'ALICE'],
    ['USERNAME', 'username', 'ALICE'],
    ['EMPLOYEE_NUMBER', 'employeeNumber', '00017'],
    ['EMP_NUM', 'employeeNumber', '00017'],
    ['PERSON_ID', 'personId', '9801'],
  ])('binds %s only to its own identity namespace', async (column, bind, expected) => {
    const { repo, query } = make([column, 'NAME']);
    await repo.readLov(ORACLE_OBJECTS.ANNUAL_TICKT_LOV, 'en', 'untrusted', {
      callerScope: alice,
      scopeAlternatives: ['17', '9801', 'someone-else'],
      personId: 'attacker',
    });
    expect(query).toHaveBeenCalledWith(
      `SELECT * FROM ${ORACLE_OBJECTS.ANNUAL_TICKT_LOV} WHERE ${column} = :${bind}`,
      { [bind]: expected },
    );
  });

  it.each(['employeeNumber', 'personId'] as const)(
    'rejects missing %s rather than substituting a different numeric namespace',
    async (claim) => {
      const column = claim === 'personId' ? 'PERSON_ID' : 'EMPLOYEE_NUMBER';
      const { repo, query } = make([column, 'NAME']);
      const caller = { ...alice, [claim]: undefined };
      await expect(repo.readLov(ORACLE_OBJECTS.ANNUAL_TICKT_LOV, 'en', undefined, {
        callerScope: caller,
      })).rejects.toBeInstanceOf(MissingIdentityClaimException);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it.each([ORACLE_OBJECTS.LEAVE_CANCEL_V, ORACLE_OBJECTS.LEAVE_AMEND_V])(
    'forces PERSON_ID for %s even when metadata lists username first',
    async (object) => {
      const { repo, query, describeColumns } = make(['USER_NAME', 'PERSON_ID']);
      await repo.readLov(object, 'en', undefined, { callerScope: alice });
      expect(query).toHaveBeenCalledWith(`SELECT * FROM ${object} WHERE PERSON_ID = :personId`, {
        personId: alice.personId,
      });
      expect(describeColumns).not.toHaveBeenCalled();
      await expect(repo.readLov(object, 'en', undefined, {
        callerScope: { username: 'alice', employeeNumber: '9801' },
      })).rejects.toBeInstanceOf(MissingIdentityClaimException);
      expect(query).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a required scope without a caller instead of using v1 semantics', async () => {
    const { repo, query } = make();
    await expect(repo.readLov(ORACLE_OBJECTS.ANNUAL_TICKT_LOV, 'en', 'alice', {
      requiredScope: 'employeeNumber',
    })).rejects.toBeInstanceOf(MissingIdentityClaimException);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a known personal LOV whose successful metadata has no usable scope', async () => {
    const { repo, query } = make(['NAME']);
    await expect(repo.readLov(ORACLE_OBJECTS.ANNUAL_TICKT_LOV, 'en', undefined, {
      callerScope: alice,
    })).rejects.toMatchObject({ status: 503 });
    expect(query).not.toHaveBeenCalled();
  });

  it('confirms genuine global LOVs from nonempty metadata', async () => {
    const { repo, query, describeColumns } = make(['CODE', 'NAME']);
    await repo.readLov(ORACLE_OBJECTS.YES_NO_LOV, 'en', undefined, { callerScope: alice });
    expect(describeColumns).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(`SELECT * FROM ${ORACLE_OBJECTS.YES_NO_LOV}`, {});
  });

  it.each(['failure', 'empty'] as const)('never unscopes on metadata %s and retries successfully', async (mode) => {
    const { repo, query, describeColumns, schema } = make();
    describeColumns.mockRejectedValueOnce(new Error('legacy failure'));
    await schema.hasColumn(ORACLE_OBJECTS.SCHOOL_NAME_LOV, 'USER_NAME');
    if (mode === 'failure') describeColumns.mockRejectedValueOnce(new Error('strict failure'));
    else describeColumns.mockResolvedValueOnce([]);
    const options: LovReadOptions = { callerScope: alice };
    await expect(repo.readLov(ORACLE_OBJECTS.SCHOOL_NAME_LOV, 'en', undefined, options))
      .rejects.toMatchObject({ status: 503 });
    expect(query).not.toHaveBeenCalled();
    await repo.readLov(ORACLE_OBJECTS.SCHOOL_NAME_LOV, 'en', undefined, options);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE USER_NAME = :username'), {
      username: 'ALICE',
    });
    expect(describeColumns).toHaveBeenCalledTimes(3);
  });

  it.each(['USER_NAME', 'EMPLOYEE_NUMBER', 'PERSON_ID'])(
    'isolates two callers and v1 caches for %s and coalesces identical strict reads',
    async (column) => {
      const { repo, query, describeColumns } = make([column, 'NAME']);
      const object = ORACLE_OBJECTS.ANNUAL_TICKT_LOV;
      const results = await Promise.all([
        repo.readLov(object, 'en', undefined, { callerScope: alice }),
        repo.readLov(object, 'en', undefined, { callerScope: alice }),
        repo.readLov(object, 'en', undefined, { callerScope: bob }),
      ]);
      expect(query).toHaveBeenCalledTimes(2);
      expect(describeColumns).toHaveBeenCalledTimes(1);
      expect(results[0]).toEqual(results[1]);
      expect(results[0]).not.toEqual(results[2]);
      await repo.readLov(object, 'en');
      expect(query).toHaveBeenCalledTimes(3);
      await repo.readLov(object, 'en', undefined, { callerScope: alice });
      expect(query).toHaveBeenCalledTimes(3);
    },
  );

  it('coalesces the same caller across tokens without caching session claims', async () => {
    const { service, query } = make();
    const sessions = ['access-1', 'access-2'].map((jti) => ({ ...alice, claims: { jti } }));
    await Promise.all(sessions.map((session) => service.getLovForCaller('SCHOOL_NAME_LOV', 'en', session)));
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('keeps required-scope choices in cache keys and never mixes numeric identifiers', async () => {
    const { repo, query } = make(['EMPLOYEE_NUMBER', 'PERSON_ID', 'NAME']);
    await repo.readLov(ORACLE_OBJECTS.ANNUAL_TICKT_LOV, 'en', undefined, {
      callerScope: alice, requiredScope: 'employeeNumber',
    });
    await repo.readLov(ORACLE_OBJECTS.ANNUAL_TICKT_LOV, 'en', undefined, {
      callerScope: alice, requiredScope: 'personId',
    });
    expect(query).toHaveBeenNthCalledWith(1,
      expect.stringContaining('WHERE EMPLOYEE_NUMBER = :employeeNumber'),
      { employeeNumber: alice.employeeNumber },
    );
    expect(query).toHaveBeenNthCalledWith(2,
      expect.stringContaining('WHERE PERSON_ID = :personId'),
      { personId: alice.personId },
    );
  });

  it('does not treat an employee-number column as a valid username scope', async () => {
    const { repo, query } = make(['EMPLOYEE_NUMBER', 'NAME']);
    await expect(repo.readLov(ORACLE_OBJECTS.SCHOOL_NAME_LOV, 'en', undefined, {
      callerScope: alice,
    })).rejects.toMatchObject({ status: 503 });
    expect(query).not.toHaveBeenCalled();
  });

  it('requires the documented annual-ticket master person scope for generic reads', async () => {
    const { service, query, describeColumns } = make(['USER_NAME', 'PERSON_ID', 'NAME']);
    await expect(service.getLovForCaller('TICKET_MASTER_LOV', 'en', { username: 'alice' }))
      .rejects.toBeInstanceOf(MissingIdentityClaimException);
    expect(describeColumns).not.toHaveBeenCalled();
    await service.getLovForCaller('TICKET_MASTER_LOV', 'en', bob);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE PERSON_ID = :personId'), {
      personId: bob.personId,
    });
  });

  it('keeps the other contract-year public name on its plural object and typed metadata scope', async () => {
    const { service, query, describeColumns } = make(['PERSON_ID', 'NAME']);
    await service.getLovForCaller('CONTRACT_YEAR_LOV', 'en', alice);
    expect(describeColumns).toHaveBeenCalledWith(ORACLE_OBJECTS.CONTRACT_YEARS_V);
    expect(query).toHaveBeenCalledWith(
      `SELECT * FROM ${ORACLE_OBJECTS.CONTRACT_YEARS_V} WHERE PERSON_ID = :personId`,
      { personId: alice.personId },
    );
  });

  it('preserves safe bound search, pagination and leave-type filters in strict mode', async () => {
    const { repo, query } = make(['USER_NAME', 'NAME']);
    await repo.readLov(ORACLE_OBJECTS.SCHOOL_NAME_LOV, 'en', undefined, {
      callerScope: alice, requiredScope: 'username', search: "doha' OR 1=1", offset: 20, limit: 10,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE USER_NAME = :username AND UPPER(NAME) LIKE :search'),
      { username: 'ALICE', search: "%DOHA' OR 1=1%", offset: 20, limit: 10 },
    );
    await repo.readLov(ORACLE_OBJECTS.LEAVE_CANCEL_V, 'en', undefined, {
      callerScope: alice, requiredScope: 'personId', leaveType: 'Casual Leave',
    });
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('WHERE PERSON_ID = :personId AND UPPER(NAME) LIKE :leaveType'),
      { personId: alice.personId, leaveType: '%CASUAL LEAVE%' },
    );
  });

  function applications(context: ReturnType<typeof make>) {
    const employment = jest.fn().mockResolvedValue({ job: 'Nurse' });
    const config = { get: jest.fn(() => 20000) } as unknown as ConfigService;
    return {
      leave: new LeaveService({ getEmploymentContext: employment } as unknown as LeaveRepository, context.service, config),
      letters: new LettersService({} as LetterRepository, context.service),
      schools: new SchoolFeeService({} as SchoolFeeRepository, context.service),
      employment,
    };
  }

  it.each([alice, bob])('scopes every personal leave default and request subread for $username', async (caller) => {
    const context = make(['USER_NAME', 'NAME']);
    const { leave, employment } = applications(context);
    const defaults = await leave.defaultsForCaller(caller, 'en');
    expect(employment).toHaveBeenCalledWith(caller.employeeNumber);
    expect(Object.keys(defaults.lovs)).toEqual(['annualTicket', 'library', 'alsr', 'contractYear']);
    expect(defaults.employment).toEqual({ job: 'Nurse' });
    const request = await leave.requestLovForCaller(caller, 'en');
    expect(Object.keys(request)).toEqual([
      'numOfChild', 'leaveClass', 'examCentre', 'bereavement', 'contractYear', 'types', 'reasons', 'leaveType',
    ]);
    for (const [sql, binds] of context.query.mock.calls) {
      expect(sql).toContain('WHERE USER_NAME = :username');
      expect(binds).toEqual({ username: caller.username.toUpperCase() });
    }
  });

  it('fails defaults before business reads without an employee claim', async () => {
    const context = make();
    const { leave, employment } = applications(context);
    await expect(leave.defaultsForCaller({ username: 'alice' }, 'en'))
      .rejects.toBeInstanceOf(MissingIdentityClaimException);
    expect(employment).not.toHaveBeenCalled();
    expect(context.query).not.toHaveBeenCalled();
  });

  it.each(['cancelLovForCaller', 'amendLovForCaller'] as const)(
    'requires person identity before the %s partial-result helper', async (method) => {
      const context = make();
      const { leave } = applications(context);
      await expect(leave[method]({ username: 'alice', employeeNumber: '9801' }, 'en'))
        .rejects.toBeInstanceOf(MissingIdentityClaimException);
      expect(context.query).not.toHaveBeenCalled();
      expect(context.describeColumns).not.toHaveBeenCalled();
    },
  );

  it('does not swallow dynamically discovered missing identity in a leave aggregate', async () => {
    const context = make(['PERSON_ID', 'NAME']);
    const { leave } = applications(context);
    await expect(leave.requestLovForCaller({ username: 'alice' }, 'en'))
      .rejects.toBeInstanceOf(MissingIdentityClaimException);
    expect(context.query).not.toHaveBeenCalled();
  });

  it('retains ordinary partial-result fallbacks without an unfiltered retry', async () => {
    const context = make();
    const { leave } = applications(context);
    context.query.mockRejectedValue(new Error('ordinary database failure'));
    await expect(leave.cancelLovForCaller(alice, 'en')).resolves.toEqual([]);
    expect(context.query).toHaveBeenCalledTimes(1);
    expect(context.query).toHaveBeenCalledWith(expect.stringContaining('WHERE PERSON_ID = :personId'), {
      personId: alice.personId,
    });
  });

  it.each([alice, bob])('scopes letters and school APIs for $username with unchanged shapes and options', async (caller) => {
    const context = make();
    const { letters, schools, leave } = applications(context);
    const result = await letters.getLetterLovsForCaller('en', caller);
    expect(Object.keys(result)).toEqual(['mobileNo', 'defaultCopy', 'country', 'name', 'language', 'exitCopies', 'deliveryLoc']);
    await schools.schoolsLovForCaller('en', caller, { search: 'doha', offset: 20, limit: 10 });
    await schools.requestTypeLovForCaller('en', caller);
    await leave.returnLovForCaller(caller, 'en');
    for (const [sql, binds] of context.query.mock.calls) {
      expect(sql).toContain('WHERE USER_NAME = :username');
      expect(binds.username).toBe(caller.username.toUpperCase());
    }
    expect(context.query).toHaveBeenCalledWith(expect.stringContaining('OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY'), {
      username: caller.username.toUpperCase(), search: '%DOHA%', offset: 20, limit: 10,
    });
  });

  it('keeps v1 aggregates unscoped and uses the legacy employee employment input', async () => {
    const context = make();
    const { leave, employment } = applications(context);
    await leave.defaults('query-employee', 'en');
    await leave.requestLov('en');
    expect(employment).toHaveBeenCalledWith('query-employee');
    expect(context.describeColumns).not.toHaveBeenCalled();
    for (const [sql, binds] of context.query.mock.calls) {
      expect(sql).not.toContain('WHERE');
      expect(binds).toEqual({});
    }
  });

  it('forces the special public contract-years name to singular USER_NAME without metadata', async () => {
    const { service, query, describeColumns } = make();
    describeColumns.mockRejectedValue(new Error('metadata unavailable'));
    await service.getLovForCaller('CONTRACT_YEARS_V', 'en', alice);
    await service.getLovForCaller('CONTRACT_YEARS_V', 'en', bob);
    expect(query).toHaveBeenNthCalledWith(1,
      `SELECT * FROM ${ORACLE_OBJECTS.CONTRACT_YEAR_V} WHERE USER_NAME = :username`,
      { username: 'ALICE' },
    );
    expect(query).toHaveBeenNthCalledWith(2,
      `SELECT * FROM ${ORACLE_OBJECTS.CONTRACT_YEAR_V} WHERE USER_NAME = :username`,
      { username: 'BOB' },
    );
    expect(describeColumns).not.toHaveBeenCalled();
  });
});
