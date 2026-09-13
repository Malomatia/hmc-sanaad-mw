import { BaseOracleRepository } from './base.repository';
import { OracleService } from './oracle.service';
import { OracleSchemaService } from './oracle-schema.service';
import { OracleMetadataService } from './oracle-metadata.service';
import { SchemaColumnNotFoundException } from './schema-column-not-found.error';
import { SchoolFeeOracleRepository } from '@modules/school-fees/infrastructure/oracle/school-fees.oracle.repository';

/** Minimal concrete subclass so the protected `toSubmitResult` can be tested
 * directly, without going through a real Oracle call. */
class TestRepository extends BaseOracleRepository {
  constructor(ora?: Partial<OracleService>, schema?: Partial<OracleSchemaService>) {
    super((ora ?? {}) as OracleService, schema as OracleSchemaService);
  }

  public expose(out: Record<string, any>) {
    return this.toSubmitResult(out);
  }

  public exposeReadIn(
    object: string,
    values: readonly (string | undefined)[],
    candidates: readonly string[],
  ) {
    return this.readByResolvedKeyIn(object, values, candidates);
  }

  public exposeTableFn(
    object: string,
    args: readonly unknown[],
    maxRows?: number,
    containsFilter?: { column: string; value: string },
  ) {
    return this.queryTableFunction(object, args, maxRows, containsFilter);
  }

  public exposeConfigured(kind: 'submit' | 'rows' | 'function') {
    const object = 'XXHMC_SND_TEST_PR';
    const params = ['p_user_name'];
    const values = { p_user_name: 'TESTUSER' };
    if (kind === 'submit') return this.callSubmitProc(object, params, values);
    if (kind === 'rows') return this.callRowsProc(object, params, values);
    return this.callRowsOrTableFunction(object, params, values);
  }
}

/**
 * XXHMC_SND_APPROVE_REJECT_PR returned `{ p_success_flag: null, p_error_msg:
 * null, p_error_msg_ar: null }` for a decision on an item that does not exist
 * (or was already actioned) — every OUT bind left unset instead of
 * `p_success_flag = 'N'` with an explanation. Before this fix that produced
 * the generic "Operation failed", indistinguishable from a real failure.
 */
describe('BaseOracleRepository.toSubmitResult', () => {
  const repo = new TestRepository();

  it('reports a specific message when every OUT bind is null (no signal at all)', () => {
    const result = repo.expose({
      p_success_flag: null,
      p_error_msg: null,
      p_error_msg_ar: null,
    });
    expect(result.status).toBe('error');
    expect(result.successflag).toBe('N');
    expect(result.errormessage).toBe(
      'No matching record was found for this request, or it has already been processed.',
    );
  });

  it('still reports the real message for an ordinary business-rule failure', () => {
    const result = repo.expose({
      p_success_flag: 'N',
      p_error_msg: 'Dependent does not exist',
      p_error_msg_ar: 'المعال غير موجود.',
    });
    expect(result.status).toBe('error');
    expect(result.errormessage).toBe('Dependent does not exist');
  });

  it('still reports success when the flag is S/Y', () => {
    const result = repo.expose({ p_success_flag: 'Y', p_error_msg: null });
    expect(result.status).toBe('success');
    expect(result.successflag).toBe('S');
    expect(result.errormessage).toBe('Success');
  });

  /**
   * `select`/`from`/`update` are ordinary English words: op 10's real
   * validation text (" 01-OCT-26 does not fall between 01-SEP-2025 to
   * 31-AUG-2026. Please select the correct Contractual Year") was suppressed to
   * the generic database-error message because the leak filter matched bare
   * `\bSELECT\b`. Business prose must pass through untouched.
   */
  it('returns validation prose containing SQL keywords as English words', () => {
    const prose =
      ' 01-OCT-26 does not fall between   01-SEP-2025 to 31-AUG-2026. ' +
      'Please select the correct Contractual Year';
    const result = repo.expose({ p_success_flag: 'N', p_error_msg: prose });
    expect(result.status).toBe('error');
    expect(result.errormessage).toBe(prose);
  });

  it.each(['p_message', 'p_error_msg', 'msg', 'errormessage'])(
    'returns the Oracle description from %s without the code or stack',
    (field) => {
      const result = repo.expose({
        p_success_flag: 'N',
        [field]: 'ORA-01403: no data found\nORA-06512: at "APPS.XXHMC_SND_TEST", line 12',
      });
      expect(result).toMatchObject({
        status: 'error',
        successflag: 'N',
        errormessage: 'no data found',
      });
    },
  );

  it('does not let a blank message hide the real Oracle error', () => {
    expect(repo.expose({
      p_success_flag: 'N',
      p_message: '  ',
      p_error_msg: 'ORA-01403: no data found',
    }).errormessage).toBe('no data found');
  });

  it('strips Oracle prefixes independently in the Arabic message', () => {
    const result = repo.expose({
      p_success_flag: 'N',
      p_error_msg: 'ORA-01403: no data found',
      p_error_msg_ar: encodeURIComponent('ORA-01403: المعال غير موجود.'),
    });
    expect(result.errormessage).toBe('no data found');
    expect(result.errormessageAr).toBe('المعال غير موجود.');
  });

  it('drops unsafe Arabic detail even when the English error is plain text', () => {
    const result = repo.expose({
      p_success_flag: 'N',
      p_error_msg: 'Dependent does not exist',
      p_error_msg_ar: 'ORA-20001: failure in XXHMC_SND_LEAV_PKG',
    });
    expect(result.errormessage).toBe('Dependent does not exist');
    expect(result.errormessageAr).toBeUndefined();
  });

  it('still suppresses genuinely technical proc messages', () => {
    for (const leak of [
      'error in XXHMC_SND_LEAV_OF_ABSEN_NEW_PR',
      'failed: SELECT NVL(days, 0) FROM absence_table WHERE id = :1',
    ]) {
      const result = repo.expose({ p_success_flag: 'N', p_error_msg: leak });
      expect(result.errormessage).toBe('The database request failed.');
    }
  });

  it('surfaces the human text of an ORA-20xxx business raise in p_error_msg', () => {
    const result = repo.expose({
      p_success_flag: 'N',
      p_error_msg: 'ORA-20001: Leave dates overlap an existing request ORA-06512: at line 12',
    });
    expect(result.errormessage).toBe('Leave dates overlap an existing request');
  });

  it('falls back to the generic business message when the raise text is itself technical', () => {
    const result = repo.expose({
      p_success_flag: 'N',
      p_error_msg: 'ORA-20001: failure in XXHMC_SND_LEAV_PKG ORA-06512: at line 12',
    });
    expect(result.errormessage).toBe('The requested operation cannot be completed.');
  });
});

/**
 * readByResolvedKeyIn fetches child rows keyed by IDs gathered from a parent
 * view (profile: DEP_PHONE_V by the EMP_CONTACT_V dependents' DEPENDENT_ID,
 * DEP_ADDRESS_V by their ADDRESS_ID).
 */
describe('BaseOracleRepository.readByResolvedKeyIn', () => {
  const makeRepo = (rows: Record<string, any>[] = []) => {
    const query = jest.fn().mockResolvedValue(rows);
    const resolveKeyColumn = jest.fn().mockResolvedValue('DEPENDENT_ID');
    const repo = new TestRepository({ query } as any, { resolveKeyColumn } as any);
    return { repo, query, resolveKeyColumn };
  };

  it('binds each distinct id and filters with IN on the resolved column', async () => {
    const { repo, query } = makeRepo([{ PHONE_ID: '1' }]);
    const rows = await repo.exposeReadIn('XXHMC_SND_DEP_PHONE_V', ['11', '22', '11'], [
      'dependent_id',
    ]);
    expect(rows).toEqual([{ PHONE_ID: '1' }]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      'SELECT * FROM XXHMC_SND_DEP_PHONE_V WHERE DEPENDENT_ID IN (:k0, :k1)',
      { k0: '11', k1: '22' },
    );
  });

  it('skips the round trip entirely when no usable id exists', async () => {
    const { repo, query, resolveKeyColumn } = makeRepo();
    const rows = await repo.exposeReadIn('XXHMC_SND_DEP_PHONE_V', [undefined, ''], [
      'dependent_id',
    ]);
    expect(rows).toEqual([]);
    expect(resolveKeyColumn).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('degrades to an empty result on a schema mismatch (like readByResolvedKey)', async () => {
    const query = jest.fn();
    const resolveKeyColumn = jest
      .fn()
      .mockRejectedValue(
        new SchemaColumnNotFoundException('XXHMC_SND_DEP_PHONE_V', ['dependent_id'], ['OTHER']),
      );
    const repo = new TestRepository({ query } as any, { resolveKeyColumn } as any);
    await expect(
      repo.exposeReadIn('XXHMC_SND_DEP_PHONE_V', ['11'], ['dependent_id']),
    ).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('chunks past the 1000-item Oracle IN-list limit', async () => {
    const { repo, query } = makeRepo([]);
    const ids = Array.from({ length: 1001 }, (_, i) => String(i));
    await repo.exposeReadIn('XXHMC_SND_DEP_PHONE_V', ids, ['dependent_id']);
    expect(query).toHaveBeenCalledTimes(2);
    expect((query.mock.calls[1][0] as string)).toContain('IN (:k0)');
  });
});

/**
 * queryTableFunction's containsFilter backs the supervisor-view search
 * (GET /employee/supervisor/views?searchKeyWord=): the filter must sit in the
 * same WHERE as the ROWNUM cap so it applies to the full row set (31k+ rows on
 * staging), not just the first `maxRows` fetched.
 */
describe('BaseOracleRepository.queryTableFunction containsFilter', () => {
  const makeRepo = () => {
    const query = jest.fn().mockResolvedValue([]);
    const repo = new TestRepository({ query } as any);
    return { repo, query };
  };

  it('adds a bound case-insensitive LIKE before the ROWNUM cap', async () => {
    const { repo, query } = makeRepo();
    await repo.exposeTableFn('XXHMC_SND_SUPERVISOR_VIEW', ['V-TEST', null], undefined, {
      column: 'FULL_NAME',
      value: ' hajar ',
    });
    expect(query).toHaveBeenCalledWith(
      'SELECT * FROM TABLE(XXHMC_SND_SUPERVISOR_VIEW(:arg0, :arg1)) ' +
        'WHERE UPPER(FULL_NAME) LIKE :filterValue AND ROWNUM <= :maxRows',
      { maxRows: 2000, arg0: 'V-TEST', arg1: null, filterValue: '%HAJAR%' },
    );
  });

  it('keeps the plain ROWNUM-only query when no filter (or a blank one) is given', async () => {
    const { repo, query } = makeRepo();
    await repo.exposeTableFn('XXHMC_SND_SUPERVISOR_VIEW', ['V-TEST', null], undefined, {
      column: 'FULL_NAME',
      value: '   ',
    });
    expect(query).toHaveBeenCalledWith(
      'SELECT * FROM TABLE(XXHMC_SND_SUPERVISOR_VIEW(:arg0, :arg1)) WHERE ROWNUM <= :maxRows',
      { maxRows: 2000, arg0: 'V-TEST', arg1: null },
    );
  });
});

describe('SchoolFeeOracleRepository.getChildren', () => {
  const input = { employeeNumber: 'test.User', academicYearStartDate: '20250901', lang: 'en' as const };
  const sql =
    'SELECT * FROM TABLE(XXHMC_SND_CHILD_DETS_VIEW(:arg0, :arg1)) WHERE ROWNUM <= :maxRows';
  const binds = { maxRows: 2000, arg0: '20250901', arg1: 'TEST.USER' };

  function make() {
    const rows = [{ CHILD_ID: 101, USER_NAME: 'TEST.USER', EXTRA: 'preserved' }];
    const query = jest.fn().mockResolvedValue(rows);
    const callCursor = jest.fn().mockResolvedValue([]);
    const schema = {
      resolveParams: jest.fn().mockResolvedValue(undefined),
      resolveSignature: jest.fn().mockResolvedValue(undefined),
      resolveKeyColumn: jest.fn().mockResolvedValue('USER_NAME'),
    };
    const repo = new SchoolFeeOracleRepository(
      { query, callCursor } as unknown as OracleService,
      schema as unknown as OracleSchemaService,
    );
    return { repo, query, callCursor, schema, rows };
  }

  it.each(['en', 'ar'] as const)('uses the confirmed positional function call for %s', async (lang) => {
    const { repo, query, callCursor, schema, rows } = make();

    await expect(repo.getChildren({ ...input, lang })).resolves.toBe(rows);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(sql, binds);
    expect(callCursor).not.toHaveBeenCalled();
    expect(schema.resolveParams).not.toHaveBeenCalled();
    expect(schema.resolveSignature).not.toHaveBeenCalled();
  });

  it.each(['empty', 'unavailable', 'stale'])('does not depend on %s metadata', async (state) => {
    const { repo, query, callCursor, schema } = make();
    if (state === 'unavailable') {
      schema.resolveParams.mockRejectedValue(new Error('Metadata unavailable'));
    } else if (state === 'empty') {
      schema.resolveParams.mockResolvedValue(null);
    } else {
      schema.resolveParams.mockResolvedValue([
        { name: 'p_cursor', direction: 'OUT', dataType: 'REF CURSOR', defaulted: false },
      ]);
      schema.resolveSignature.mockResolvedValue({ params: [] });
    }

    await repo.getChildren(input);

    expect(query).toHaveBeenCalledWith(sql, binds);
    expect(callCursor).not.toHaveBeenCalled();
    expect(schema.resolveParams).not.toHaveBeenCalled();
    expect(schema.resolveSignature).not.toHaveBeenCalled();
    expect(schema.resolveKeyColumn).not.toHaveBeenCalled();
  });

  it('preserves an empty result', async () => {
    const { repo, query } = make();
    query.mockResolvedValue([]);

    await expect(repo.getChildren(input)).resolves.toEqual([]);
  });

  it('propagates query errors without retrying as a procedure', async () => {
    const { repo, query, callCursor } = make();
    const error = new Error('Oracle query failed');
    query.mockRejectedValue(error);

    await expect(repo.getChildren(input)).rejects.toBe(error);
    expect(query).toHaveBeenCalledTimes(1);
    expect(callCursor).not.toHaveBeenCalled();
  });
});

describe('BaseOracleRepository metadata failures', () => {
  it.each(['submit', 'rows', 'function'] as const)(
    'does not execute guessed SQL for %s after signature discovery fails',
    async (kind) => {
      const error = new Error('Signature discovery failed');
      const describeArguments = jest.fn().mockRejectedValue(error);
      const schema = new OracleSchemaService({ describeArguments } as unknown as OracleMetadataService);
      const ora = {
        call: jest.fn().mockResolvedValue({ p_success_flag: 'S' }),
        callCursor: jest.fn().mockResolvedValue([]),
        query: jest.fn().mockResolvedValue([]),
      };
      const repo = new TestRepository(ora, schema);

      for (let attempt = 1; attempt <= 2; attempt++) {
        await expect(repo.exposeConfigured(kind)).rejects.toBe(error);
        expect(describeArguments).toHaveBeenCalledTimes(attempt);
      }
      expect(ora.call).not.toHaveBeenCalled();
      expect(ora.callCursor).not.toHaveBeenCalled();
      expect(ora.query).not.toHaveBeenCalled();
    },
  );

  it('does not read a view with an assumed key after column discovery fails', async () => {
    const error = new Error('Column discovery failed');
    const describeColumns = jest.fn().mockRejectedValueOnce(error).mockResolvedValue([
      { name: 'PERSON_ID', dataType: 'NUMBER', nullable: false, position: 1 },
    ]);
    const schema = new OracleSchemaService({ describeColumns } as unknown as OracleMetadataService);
    const query = jest.fn().mockResolvedValue([]);
    const repo = new TestRepository({ query }, schema);

    await expect(repo.exposeReadIn('TEST_VIEW', ['1'], ['person_id'])).rejects.toBe(error);
    expect(query).not.toHaveBeenCalled();

    await expect(repo.exposeReadIn('TEST_VIEW', ['1'], ['person_id'])).resolves.toEqual([]);
    expect(describeColumns).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledWith('SELECT * FROM TEST_VIEW WHERE person_id IN (:k0)', { k0: '1' });
  });
});
