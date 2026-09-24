import { ConfigService } from '@nestjs/config';
import oracledb = require('oracledb');

import { OracleService } from './oracle.service';

const methods = ['query', 'call', 'callCursor', 'callMultiCursor'] as const;

describe.each(methods)('OracleService.%s username binds', (method) => {
  const sql =
    method === 'query'
      ? "SELECT 'Original.Mixed' AS literal FROM demo_view\n WHERE username = :username AND user_name = :p_user_name"
      : "BEGIN\n  demo_proc(:username, :p_user_name, :p_dusername, :approver_user_name, 'Original.Mixed');\nEND;";
  const options = Object.freeze({ autoCommit: false, fetchArraySize: 25 });
  const rows = Object.freeze([{ username: 'Returned.Mixed', first_name: 'Returned Name' }]);
  const otherRows = Object.freeze([{ user_name: 'Other.Mixed' }]);
  const scalarOutputs = Object.freeze({ p_dusername: 'Destination.Mixed', successflag: 's' });
  const outBinds = Object.freeze({ username: 'Returned.Mixed', ...scalarOutputs });
  let service: OracleService;

  let execute: jest.Mock;
  let close: jest.Mock;
  let getConnection: jest.Mock;

  let cursor: { getRows: jest.Mock; close: jest.Mock };
  let otherCursor: { getRows: jest.Mock; close: jest.Mock };

  beforeEach(() => {
    service = new OracleService({
      getOrThrow: jest.fn().mockReturnValue({ callTimeout: 25000 }),
    } as unknown as ConfigService);
    cursor = {
      getRows: jest.fn().mockResolvedValue(rows),
      close: jest.fn().mockResolvedValue(undefined),
    };
    otherCursor = {
      getRows: jest.fn().mockResolvedValue(otherRows),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const result =
      method === 'query'
        ? { rows }
        : method === 'call'
          ? { outBinds }
          : method === 'callCursor'
            ? { outBinds: { result_cursor: cursor } }
            : { outBinds: { first_cursor: cursor, second_cursor: otherCursor, ...scalarOutputs } };
    execute = jest.fn().mockResolvedValue(result);
    close = jest.fn().mockResolvedValue(undefined);
    getConnection = jest.fn().mockResolvedValue({ execute, close });
    service['pool'] = { getConnection } as unknown as oracledb.Pool;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function invoke(statement: string, binds: oracledb.BindParameters): Promise<unknown> {
    switch (method) {
      case 'query':
        return service.query(statement, binds);
      case 'call':
        return service.call(statement, binds, options);
      case 'callCursor':
        return service.callCursor(statement, binds, 'result_cursor');
      case 'callMultiCursor':
        return service.callMultiCursor(statement, binds, ['first_cursor', 'second_cursor']);
    }
  }

  function expectUnchangedResponse(result: unknown): void {
    if (method === 'query' || method === 'callCursor') {
      expect(result).toBe(rows);
    } else if (method === 'call') {
      expect(result).toBe(outBinds);
    } else {
      expect(result).toEqual({
        cursors: { first_cursor: rows, second_cursor: otherRows },
        scalars: scalarOutputs,
      });
      const cursors = (result as { cursors: Record<string, unknown> }).cursors;
      expect(cursors.first_cursor).toBe(rows);
      expect(cursors.second_cursor).toBe(otherRows);
    }
    if (method === 'callCursor' || method === 'callMultiCursor') {
      expect(cursor.getRows).toHaveBeenCalledWith(0);
      expect(cursor.close).toHaveBeenCalledTimes(1);
    }
    if (method === 'callMultiCursor') {
      expect(otherCursor.getRows).toHaveBeenCalledWith(0);
      expect(otherCursor.close).toHaveBeenCalledTimes(1);
    }
    expect(close).toHaveBeenCalledTimes(1);
  }

  it('normalizes named inputs before logging and execution, preserving SQL, inputs, metadata and outputs', async () => {
    const typed = Object.freeze({ type: oracledb.STRING, val: 'typed.Mixed', maxSize: 80 });
    const input = Object.freeze({
      dir: oracledb.BIND_IN,
      type: oracledb.STRING,
      val: 'input.Mixed',
    });
    const inout = Object.freeze({
      dir: oracledb.BIND_INOUT,
      type: oracledb.STRING,
      val: 'destination.Mixed',
      maxSize: 80,
    });
    const output = Object.freeze({
      dir: oracledb.BIND_OUT,
      type: oracledb.STRING,
      val: 'output.Mixed',
      maxSize: 80,
    });
    const names = Object.freeze(['from.Mixed', null, 'another.Mixed']);
    const arrayInput = Object.freeze({ dir: oracledb.BIND_IN, type: oracledb.STRING, val: names });
    const date = new Date('2026-09-01T00:00:00.000Z');
    const buffer = Buffer.from('Mixed');
    const json = Object.freeze({ username: 'Nested.Mixed', first_name: 'Nested Name' });
    const unrelatedTyped = Object.freeze({ type: oracledb.STRING, val: 'Typed Comment' });
    const binds = Object.freeze({
      username: 'login.Mixed',
      p_username: typed,
      p_user_name: input,
      p_dusername: inout,
      approver_user_name: output,
      from_user_name: arrayInput,
      to_user_name: null,
      p_to_user_name: undefined,
      requestor_user_name: 37400,
      user_name: date,
      p_from_user_name: buffer,
      u: 'alias.Mixed',
      k: 'key.Mixed',
      arg0: 'argument.Mixed',
      person_id: '037400',
      first_name: 'Mixed Name',
      filename: 'Mixed.pdf',
      password: 'KeepCase',
      user_comment: unrelatedTyped,
      payload: { type: oracledb.DB_TYPE_JSON, val: json },
    });

    const result = await invoke(sql, binds);
    const executedBinds = execute.mock.calls[execute.mock.calls.length - 1][1] as Record<
      string,
      unknown
    >;

    expect(execute).toHaveBeenCalledTimes(method === 'query' ? 1 : 2);
    expect(execute).toHaveBeenLastCalledWith(
      sql,
      {
        ...binds,
        username: 'LOGIN.MIXED',
        p_username: { ...typed, val: 'TYPED.MIXED' },
        p_user_name: { ...input, val: 'INPUT.MIXED' },
        p_dusername: { ...inout, val: 'DESTINATION.MIXED' },
        from_user_name: { ...arrayInput, val: ['FROM.MIXED', null, 'ANOTHER.MIXED'] },
      },
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        ...(method === 'query' ? {} : { autoCommit: true }),
        ...(method === 'call' ? options : {}),
      },
    );
    expect(executedBinds).not.toBe(binds);
    for (const name of ['p_username', 'p_user_name', 'p_dusername'] as const) {
      expect(executedBinds[name]).not.toBe(binds[name]);
      expect((executedBinds[name] as oracledb.BindParameter).type).toBe(binds[name].type);
    }
    const normalizedKeys = new Set([
      'username',
      'p_username',
      'p_user_name',
      'p_dusername',
      'from_user_name',
    ]);
    for (const [name, value] of Object.entries(binds)) {
      if (!normalizedKeys.has(name)) expect(executedBinds[name]).toBe(value);
    }
    expect(binds.username).toBe('login.Mixed');
    expect(typed.val).toBe('typed.Mixed');
    expect(input.val).toBe('input.Mixed');
    expect(inout.val).toBe('destination.Mixed');
    expect(output.val).toBe('output.Mixed');
    expect(names).toEqual(['from.Mixed', null, 'another.Mixed']);

    expectUnchangedResponse(result);
  });

  it('preserves normalized execution inputs, error mapping and caller binds on failure', async () => {
    const binds = Object.freeze({ username: 'login.Mixed', user_comment: 'Keep Case' });
    const failure = new Error('ORA-20001: business failure');

    execute.mockImplementation(async (statement: string) => {
      if (statement === sql) throw failure;
      return {};
    });

    await expect(invoke(sql, binds)).rejects.toMatchObject({
      name: 'OracleQueryError',
      message: failure.message,
      cause: failure,
    });

    expect(execute.mock.calls[execute.mock.calls.length - 1][1]).toEqual({
      username: 'LOGIN.MIXED',
      user_comment: 'Keep Case',
    });

    expect(binds.username).toBe('login.Mixed');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('passes positional bind arrays through unchanged, including typed inputs', async () => {
    const descriptor = Object.freeze({
      dir: oracledb.BIND_INOUT,
      type: oracledb.STRING,
      val: 'input.Mixed',
      maxSize: 80,
    });
    const binds: oracledb.BindParameters = ['login.Mixed', descriptor, null, 37400];
    Object.freeze(binds);

    const result = await invoke(sql, binds);

    expect(execute.mock.calls[execute.mock.calls.length - 1][0]).toBe(sql);
    expect(execute.mock.calls[execute.mock.calls.length - 1][1]).toBe(binds);
    expect(descriptor.val).toBe('input.Mixed');

    expectUnchangedResponse(result);
  });
});
