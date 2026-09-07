import oracledb = require('oracledb');
import { normalizeOracleUsername, normalizeOracleUsernameBinds } from './oracle-username.util';

describe('normalizeOracleUsername', () => {
  it.each([
    'username',
    'user_name',
    'p_username',
    'p_user_name',
    'from_user_name',
    'to_user_name',
    'p_from_user_name',
    'p_to_user_name',
    'p_dusername',
    'dusername',
    'requestor_user_name',
    'approver_user_name',
    'USERNAME',
    'USER_NAME',
    'P_USER_NAME',
    'P_DUSERNAME',
    'REQUESTOR_USER_NAME',
    'APPROVER_USER_NAME',
    'userName',
    'UserName',
    'pUsername',
    'pUserName',
    'fromUserName',
    'toUserName',
    'pFromUserName',
    'pToUserName',
    'pDUsername',
    'requestorUserName',
    'approverUserName',
    'p_requestor_user_name',
    'p_approver_user_name',
  ])('uppercases explicitly named username field %s', (name) => {
    expect(normalizeOracleUsername(name, 'aIbrahim39')).toBe('AIBRAHIM39');
  });

  it.each([
    'u',
    'k',
    'k0',
    'arg',
    'arg0',
    'p_arg0',
    'user',
    'p_user',
    'person_id',
    'p_person_id',
    'employee_number',
    'enum',
    'user_comment',
    'p_user_comment',
    'username_comment',
    'username_password',
    'first_name',
    'last_name',
    'filename',
    'p_filename',
    'password',
    'p_password',
    'mpin',
    'token',
    'secret',
    'description',
    'email',
    'name',
    'not_username',
    'username_suffix',
    'userNameComment',
    'user.name',
    'user-name',
  ])('does not reinterpret unrelated field %s', (name) => {
    const descriptor = Object.freeze({ type: oracledb.STRING, val: 'MiXeD' });
    expect(normalizeOracleUsername(name, 'MiXeD')).toBe('MiXeD');
    expect(normalizeOracleUsername(name, descriptor)).toBe(descriptor);
  });

  it.each(['', 'ALREADY_UPPER', '037400', ' mixed.login '])(
    'only changes case, without trimming or replacing %j',
    (value) => {
      expect(normalizeOracleUsername('username', value)).toBe(value.toUpperCase());
    },
  );

  it.each([
    null,
    undefined,
    37400,
    0,
    NaN,
    false,
    BigInt(37400),
    new Date('2026-09-01T00:00:00.000Z'),
    Buffer.from('mixed'),
  ])('preserves the non-string value %p', (value) => {
    expect(normalizeOracleUsername('username', value)).toBe(value);
  });

  it.each([
    { type: oracledb.STRING },
    { dir: oracledb.BIND_IN },
    { dir: oracledb.BIND_IN, type: oracledb.STRING },
    { dir: oracledb.BIND_INOUT, type: oracledb.STRING },
  ])('copies an input descriptor without changing its metadata: %p', (metadata) => {
    const descriptor = Object.freeze({ ...metadata, maxSize: 120, maxArraySize: 8, val: 'mixed' });
    const result = normalizeOracleUsername('p_user_name', descriptor);

    expect(result).toEqual({ ...descriptor, val: 'MIXED' });
    expect(result).not.toBe(descriptor);
    expect(descriptor.val).toBe('mixed');
    expect((result as oracledb.BindParameter).type).toBe(descriptor.type);
  });

  it.each([null, undefined, 37400, new Date('2026-09-01'), Buffer.from('mixed')])(
    'preserves non-string descriptor values: %p',
    (val) => {
      const descriptor = Object.freeze({ dir: oracledb.BIND_INOUT, type: oracledb.STRING, val });
      const result = normalizeOracleUsername('username', descriptor) as oracledb.BindParameter;
      expect(result).toEqual(descriptor);
      expect(result.val).toBe(val);
    },
  );

  it.each([{ val: 'mixed' }, { val: ['mixed'] }, { val: undefined }])(
    'leaves OUT descriptors entirely untouched: %p',
    ({ val }) => {
      const descriptor = Object.freeze({
        dir: oracledb.BIND_OUT,
        type: oracledb.STRING,
        val,
        maxSize: 80,
      });
      expect(normalizeOracleUsername('username', descriptor)).toBe(descriptor);
    },
  );

  it('does not read an OUT descriptor value', () => {
    const descriptor = {
      dir: oracledb.BIND_OUT,
      type: oracledb.STRING,
      get val(): string {
        throw new Error('OUT value must not be inspected');
      },
    };
    expect(normalizeOracleUsername('p_dusername', descriptor)).toBe(descriptor);
  });

  it('maps username arrays shallowly without mutating arrays or non-string entries', () => {
    const record = Object.freeze({ username: 'nested', val: 'nested' });
    const nestedArray = Object.freeze(['nested']);
    const date = new Date('2026-09-01');
    const buffer = Buffer.from('mixed');
    const values = Object.freeze([
      'mixed',
      'Other.Login',
      null,
      undefined,
      37400,
      date,
      buffer,
      record,
      nestedArray,
    ]);
    const result = normalizeOracleUsername('to_user_name', values) as unknown[];

    expect(result).toEqual([
      'MIXED',
      'OTHER.LOGIN',
      null,
      undefined,
      37400,
      date,
      buffer,
      record,
      nestedArray,
    ]);
    expect(result).not.toBe(values);
    expect(values[0]).toBe('mixed');
    for (let index = 2; index < values.length; index += 1) {
      expect(result[index]).toBe(values[index]);
    }
  });

  it('normalizes typed INOUT arrays without mutating their metadata or values', () => {
    const values = Object.freeze(['mixed', null, 'other']);
    const descriptor = Object.freeze({
      dir: oracledb.BIND_INOUT,
      type: oracledb.STRING,
      maxSize: 80,
      maxArraySize: 5,
      val: values,
    });

    expect(normalizeOracleUsername('p_from_user_name', descriptor)).toEqual({
      ...descriptor,
      val: ['MIXED', null, 'OTHER'],
    });
    expect(descriptor.val).toBe(values);
    expect(values).toEqual(['mixed', null, 'other']);
  });

  it('does not rewrite arbitrary JSON records or records inside typed values', () => {
    const record = Object.freeze({ username: 'nested', user_name: 'nested', val: 'mixed' });
    const descriptor = Object.freeze({ type: oracledb.DB_TYPE_JSON, val: record });

    expect(normalizeOracleUsername('username', record)).toBe(record);
    expect(normalizeOracleUsername('username', { val: 'mixed' })).toEqual({ val: 'mixed' });
    expect((normalizeOracleUsername('username', descriptor) as oracledb.BindParameter).val).toBe(
      record,
    );
  });
});

describe('normalizeOracleUsernameBinds', () => {
  it('normalizes named binds without mutating caller-owned binds or unrelated values', () => {
    const date = new Date('2026-09-01');
    const buffer = Buffer.from('mixed');
    const json = Object.freeze({ username: 'nested', first_name: 'Mixed' });
    const input = Object.freeze({
      dir: oracledb.BIND_INOUT,
      type: oracledb.STRING,
      val: 'destination',
      maxSize: 80,
    });
    const output = Object.freeze({
      dir: oracledb.BIND_OUT,
      type: oracledb.STRING,
      val: 'output',
      maxSize: 80,
    });
    const binds = Object.freeze({
      userName: 'mixed',
      p_dusername: input,
      approver_user_name: output,
      p_to_user_name: null,
      from_user_name: undefined,
      requestor_user_name: 37400,
      user_name: date,
      p_user_name: buffer,
      u: 'untouched',
      k: 'untouched',
      arg0: 'untouched',
      person_id: '037400',
      first_name: 'Mixed',
      password: 'KeepCase',
      filename: 'Mixed.pdf',
      user_comment: 'Keep this Case',
      payload: { type: oracledb.DB_TYPE_JSON, val: json },
    });
    const result = normalizeOracleUsernameBinds(binds) as Record<string, unknown>;

    expect(result).toEqual({
      ...binds,
      userName: 'MIXED',
      p_dusername: { ...input, val: 'DESTINATION' },
    });
    expect(result).not.toBe(binds);
    expect(result.p_dusername).not.toBe(input);
    for (const [name, value] of Object.entries(binds)) {
      if (name !== 'userName' && name !== 'p_dusername') expect(result[name]).toBe(value);
    }
    expect(binds.userName).toBe('mixed');
    expect(input.val).toBe('destination');
    expect(output.val).toBe('output');
  });

  it('returns positional arrays untouched because their values have no field names', () => {
    const descriptor = Object.freeze({
      dir: oracledb.BIND_IN,
      type: oracledb.STRING,
      val: 'mixed',
    });
    const binds: oracledb.BindParameters = ['mixed', descriptor, null, 37400];
    Object.freeze(binds);

    expect(normalizeOracleUsernameBinds(binds)).toBe(binds);
    expect(binds).toEqual(['mixed', descriptor, null, 37400]);
    expect(descriptor.val).toBe('mixed');
  });

  it('accepts empty named and positional binds', () => {
    expect(normalizeOracleUsernameBinds({})).toEqual({});
    const positional: oracledb.BindParameters = [];
    expect(normalizeOracleUsernameBinds(positional)).toBe(positional);
  });
});
