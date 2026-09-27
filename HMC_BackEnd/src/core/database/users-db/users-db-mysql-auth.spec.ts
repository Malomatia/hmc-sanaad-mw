import { HttpException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthStateService } from '@core/auth/auth-state.service';
import { SecureOtpRepository } from '@modules/auth/infrastructure/adapters/secure-otp.repository';
import { toPositional } from './named-params.util';
import { UsersDbExecutor, UsersDbService } from './users-db.service';

/**
 * USERS_DB_DRIVER=mysql for the pentest-hardened auth code: sessions, rate
 * budgets, enrollment/reset grants (AuthStateService) and OTPs
 * (SecureOtpRepository). On SQL Server each unit is one T-SQL batch; on MySQL
 * it is a transaction of statements, and these tests pin both the order of
 * those statements and the outcome of each branch.
 */

const T_SQL_ONLY =
  /\bGETDATE\(|\bTOP\s+\d|\bOUTPUT\b|\bMERGE\b|\bIF\b|BEGIN\s+TRY|@@ROWCOUNT|\bDECLARE\b|\bUPDLOCK\b|\bHOLDLOCK\b|\bCOLLATE\b|\bISNULL\(|\bDATEADD\(|\bDATEDIFF\(|\bnvarchar\b/i;

interface Call {
  sql: string;
  params: Record<string, unknown>;
  inTransaction: boolean;
}
type Answer = { rows?: Record<string, unknown>[]; rowsAffected?: number };

/** A MySQL-dialect UsersDbService whose answers come from `script`. */
function scriptedMysql(
  script: (sql: string, params: Record<string, unknown>) => Answer = () => ({}),
) {
  const calls: Call[] = [];
  let transactions = 0;
  const answer = (sql: string, params: Record<string, unknown>, inTransaction: boolean) => {
    calls.push({ sql, params, inTransaction });
    const result = script(sql, params);
    return { rows: result.rows ?? [], rowsAffected: result.rowsAffected ?? 1 };
  };
  const executor = (inTransaction: boolean): UsersDbExecutor => ({
    query: async <T>(sql: string, params: Record<string, unknown> = {}) =>
      answer(sql, params, inTransaction).rows as T[],
    execute: async (sql: string, params: Record<string, unknown> = {}) => {
      const { rows, rowsAffected } = answer(sql, params, inTransaction);
      return { rows: rows as never[], rowsAffected };
    },
  });
  const db = {
    dialect: 'mysql',
    ...executor(false),
    transaction: async <T>(work: (tx: UsersDbExecutor) => Promise<T>) => {
      transactions++;
      return work(executor(true));
    },
  } as unknown as UsersDbService;
  return { db, calls, transactions: () => transactions };
}

/** No SQL Server syntax, and every `@name` bound (MySQL would read it as a NULL user variable). */
function expectRunnableOnMysql(calls: Call[]) {
  expect(calls.length).toBeGreaterThan(0);
  for (const { sql, params } of calls) {
    expect(sql).not.toMatch(T_SQL_ONLY);
    expect(toPositional(sql, params).sql).not.toMatch(/@[A-Za-z_]/);
  }
}

const matches = (pattern: RegExp) => (sql: string) => pattern.test(sql);
const isDeviceLock = matches(/COUNT\(\*\) AS Matches[\s\S]*FOR UPDATE/);
const isClaim = (bind: string) =>
  matches(
    new RegExp(`SET UsedAt = NOW\\(\\)[\\s\\S]*Challenge = @${bind}[\\s\\S]*ExpiresAt > NOW\\(\\)`),
  );
const isRevokeAll = matches(/LIKE 'hF\.%'/);
const isMpinUpdate = matches(/UPDATE HMC_Sanad_DeviceRegn_tbl/);

const config = new ConfigService({
  auth: { jwtSecret: 'test-shared-nonce-key-never-used-in-production' },
});
const GRANT = 'g'.repeat(43);

describe('AuthStateService on MySQL', () => {
  describe('limit()', () => {
    it('counts the budget under FOR UPDATE and records the attempt in the same transaction', async () => {
      const { db, calls, transactions } = scriptedMysql((sql) =>
        /COUNT\(\*\) AS Attempts/.test(sql) ? { rows: [{ Attempts: 0, RetryAfter: null }] } : {},
      );
      await expect(
        new AuthStateService(db, config).limit('login', 'user', 5, 900),
      ).resolves.toBeUndefined();

      expect(transactions()).toBe(1);
      expect(calls[0].sql).toMatch(/LIKE @bucketTokenPrefix ESCAPE '~'[\s\S]*FOR UPDATE/);
      expect(calls[1].sql).toMatch(
        /INSERT INTO HMC_Sanad_AttestChallenge_tbl[\s\S]*INTERVAL @seconds SECOND/,
      );
      expect(calls.every((c) => c.inTransaction)).toBe(true);
      expectRunnableOnMysql(calls);
    });

    it('refuses with 429 and the retry time once the budget is spent, without recording', async () => {
      const { db, calls } = scriptedMysql(() => ({ rows: [{ Attempts: 5, RetryAfter: 42 }] }));
      const failure = await new AuthStateService(db, config)
        .limit('login', 'user', 5, 900)
        .catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(HttpException);
      expect((failure as HttpException).getStatus()).toBe(429);
      expect((failure as HttpException).getResponse()).toMatchObject({ retryAfterSeconds: 42 });
      expect(calls).toHaveLength(1);
    });
  });

  it('issues an enrollment grant with one INSERT', async () => {
    const { db, calls, transactions } = scriptedMysql();
    await new AuthStateService(db, config).issueEnrollment('user', 'device');

    expect(transactions()).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/DATE_ADD\(NOW\(\), INTERVAL @ttl SECOND\)/);
    expectRunnableOnMysql(calls);
  });

  describe('enroll()', () => {
    it('locks the device, claims the grant, then activates only an Inactive row without an MPIN', async () => {
      const { db, calls } = scriptedMysql((sql) =>
        isDeviceLock(sql) ? { rows: [{ Matches: 1 }] } : {},
      );
      await expect(
        new AuthStateService(db, config).enroll('user', 'device', 'hash', GRANT),
      ).resolves.toBe(true);

      expect(isDeviceLock(calls[0].sql)).toBe(true);
      expect(isClaim('grantTokenKey')(calls[1].sql)).toBe(true);
      expect(calls[2].sql).toMatch(/MPIN IS NULL AND Status = 'Inactive'/);
      expect(calls[0].sql).toContain('CAST(IMEINumber AS BINARY) = @imei');
      expectRunnableOnMysql(calls);
    });

    it('stops before the grant when the device is not registered', async () => {
      const { db, calls } = scriptedMysql(() => ({ rows: [{ Matches: 0 }] }));
      await expect(
        new AuthStateService(db, config).enroll('user', 'device', 'hash', GRANT),
      ).resolves.toBe(false);
      expect(calls).toHaveLength(1);
    });

    it('never touches the MPIN when the grant cannot be claimed (spent, expired, other user)', async () => {
      const { db, calls } = scriptedMysql((sql) =>
        isDeviceLock(sql) ? { rows: [{ Matches: 1 }] } : { rowsAffected: 0 },
      );
      await expect(
        new AuthStateService(db, config).enroll('user', 'device', 'hash', GRANT),
      ).resolves.toBe(false);
      expect(calls.some((c) => isMpinUpdate(c.sql))).toBe(false);
    });
  });

  describe('MPIN reset', () => {
    it('OTP path: updates an Active row with an MPIN, then ends every session', async () => {
      const { db, calls } = scriptedMysql((sql) =>
        isDeviceLock(sql) ? { rows: [{ Matches: 1 }] } : {},
      );
      await expect(
        new AuthStateService(db, config).resetMpin('user', 'device', 'hash'),
      ).resolves.toBe(true);

      expect(calls.some((c) => isClaim('grantTokenKey')(c.sql))).toBe(false);
      expect(calls[1].sql).toMatch(/Status = 'Active' AND MPIN IS NOT NULL/);
      expect(isRevokeAll(calls[2].sql)).toBe(true);
      expectRunnableOnMysql(calls);
    });

    it('grant path: claims the grant before the MPIN, and revokes sessions afterwards', async () => {
      const { db, calls } = scriptedMysql((sql) =>
        isDeviceLock(sql) ? { rows: [{ Matches: 1 }] } : {},
      );
      await expect(
        new AuthStateService(db, config).resetMpinWithGrant('user', 'device', 'hash', GRANT),
      ).resolves.toBe(true);

      expect(isClaim('grantTokenKey')(calls[1].sql)).toBe(true);
      expect(isMpinUpdate(calls[2].sql)).toBe(true);
      expect(isRevokeAll(calls[3].sql)).toBe(true);
      expectRunnableOnMysql(calls);
    });

    it('grant path: an unclaimable grant changes nothing', async () => {
      const { db, calls } = scriptedMysql((sql) =>
        isDeviceLock(sql) ? { rows: [{ Matches: 1 }] } : { rowsAffected: 0 },
      );
      await expect(
        new AuthStateService(db, config).resetMpinWithGrant('user', 'device', 'hash', GRANT),
      ).resolves.toBe(false);
      expect(calls.some((c) => isMpinUpdate(c.sql) || isRevokeAll(c.sql))).toBe(false);
    });

    it('does not revoke sessions when no qualifying row was updated', async () => {
      const { db, calls } = scriptedMysql((sql) =>
        isDeviceLock(sql)
          ? { rows: [{ Matches: 1 }] }
          : isMpinUpdate(sql)
            ? { rowsAffected: 0 }
            : {},
      );
      await expect(
        new AuthStateService(db, config).resetMpin('user', 'device', 'hash'),
      ).resolves.toBe(false);
      expect(calls.some((c) => isRevokeAll(c.sql))).toBe(false);
    });
  });

  describe('sessions', () => {
    const future = () => new Date(Date.now() + 3600000);

    it('creates family/access/refresh nonces only after re-checking the active MPIN', async () => {
      const { db, calls } = scriptedMysql((sql) =>
        isDeviceLock(sql) ? { rows: [{ Matches: 1 }] } : {},
      );
      const state = new AuthStateService(db, config);
      await state.createSession(state.newSession('user', 'device', future()), 'hash');

      expect(calls[0].sql).toMatch(/MPIN = @mpin AND Status = 'Active'[\s\S]*FOR UPDATE/);
      expect(calls[1].sql).toMatch(/@familyTokenKey[\s\S]*@accessTokenKey[\s\S]*@refreshTokenKey/);
      expectRunnableOnMysql(calls);
    });

    it('refuses a wrong MPIN without creating anything', async () => {
      const { db, calls } = scriptedMysql(() => ({ rows: [{ Matches: 0 }] }));
      const state = new AuthStateService(db, config);
      await expect(
        state.createSession(state.newSession('user', 'device', future()), 'wrong'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(calls).toHaveLength(1);
    });

    it('checks a session in one query, with or without an access key', async () => {
      const { db, calls, transactions } = scriptedMysql(() => ({ rows: [{ Active: 1 }] }));
      const state = new AuthStateService(db, config);

      await expect(state.sessionActive('sid', 'user', 'device', 'access')).resolves.toBe(true);
      await expect(state.sessionActive('sid', 'user', 'device')).resolves.toBe(true);
      expect(transactions()).toBe(0);
      expect(calls[1].params.accessTokenKey).toBeNull();
      expect(calls[0].sql).toMatch(/@accessTokenKey IS NULL OR EXISTS/);
      expectRunnableOnMysql(calls);
    });

    it('rotates: spends the previous refresh and access nonces, issues new ones, extends the family', async () => {
      const { db, calls } = scriptedMysql((sql) =>
        isDeviceLock(sql)
          ? { rows: [{ Matches: 1 }] }
          : /SELECT 1 AS Live/.test(sql)
            ? { rows: [{ Live: 1 }] }
            : {},
      );
      const state = new AuthStateService(db, config);
      await state.rotateSession(state.newSession('user', 'device', future()), 'previous-refresh');

      expect(isClaim('previousRefreshTokenKey')(calls[2].sql)).toBe(true);
      expect(calls[3].sql).toContain('@previousAccessTokenKey');
      expect(calls[4].sql).toMatch(/INSERT INTO[\s\S]*@accessTokenKey[\s\S]*@refreshTokenKey/);
      expect(calls[5].sql).toMatch(/SET ExpiresAt = DATE_ADD\(NOW\(\), INTERVAL @ttl SECOND\)/);
      expect(calls).toHaveLength(6);
      expectRunnableOnMysql(calls);
    });

    it('ends the whole session family on a replayed refresh (and still commits that)', async () => {
      const { db, calls } = scriptedMysql((sql) =>
        isDeviceLock(sql)
          ? { rows: [{ Matches: 1 }] }
          : /SELECT 1 AS Live/.test(sql)
            ? { rows: [{ Live: 1 }] }
            : { rowsAffected: 0 },
      );
      const state = new AuthStateService(db, config);
      await expect(
        state.rotateSession(state.newSession('user', 'device', future()), 'replayed'),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      const last = calls[calls.length - 1];
      expect(last.sql).toMatch(/SET UsedAt = NOW\(\)[\s\S]*Challenge = @familyTokenKey/);
      expect(last.inTransaction).toBe(true);
      expect(calls.some((c) => /INSERT INTO/.test(c.sql))).toBe(false);
    });

    it('revokes a session with one UPDATE', async () => {
      const { db, calls } = scriptedMysql();
      await new AuthStateService(db, config).revokeSession('sid', 'user', 'device');
      expect(calls).toHaveLength(1);
      expectRunnableOnMysql(calls);
    });
  });
});

describe('SecureOtpRepository on MySQL', () => {
  function make(script: Parameters<typeof scriptedMysql>[0]) {
    const scripted = scriptedMysql(script);
    const repository = new SecureOtpRepository(
      scripted.db,
      { limit: jest.fn().mockResolvedValue(undefined) } as unknown as AuthStateService,
      { sendOtpSms: jest.fn().mockResolvedValue(undefined) },
      { sendOtpEmail: jest.fn().mockResolvedValue(undefined) },
      new ConfigService({
        otp: {
          length: 6,
          ttlSeconds: 300,
          maxAttempts: 5,
          staticValue: '012345',
          charset: 'numeric',
        },
      }),
    );
    return { ...scripted, repository };
  }
  const SEND = {
    username: 'user',
    imei: 'device',
    phoneNumber: '55550000',
    purpose: 'FORGOT_MPIN' as const,
  };

  it('stores the first OTP with an INSERT, then activates it after delivery', async () => {
    const { repository, calls } = make((sql) =>
      /MAX\(SeqNo\)/.test(sql) ? { rows: [{ SeqNo: null }] } : {},
    );
    await expect(repository.send(SEND)).resolves.toMatchObject({ status: 'NEW', mode: 'SMS' });

    expect(calls[0].sql).toMatch(/MAX\(SeqNo\)[\s\S]*FOR UPDATE/);
    expect(calls[1].sql).toMatch(/INSERT INTO HMC_RHAP_OTP_tbl[\s\S]*@requestType/);
    expect(calls[1].params.requestType).toBe('FORGET_MPIN');
    expect(calls[2].sql).toMatch(
      /SET OTPStatus = '1'[\s\S]*DATE_SUB\(NOW\(\), INTERVAL @ttl SECOND\)/,
    );
    expect(calls[2].inTransaction).toBe(false);
    expectRunnableOnMysql(calls);
  });

  it('overwrites the existing row of the user+device instead of adding one', async () => {
    const { repository, calls } = make((sql) =>
      /MAX\(SeqNo\)/.test(sql) ? { rows: [{ SeqNo: 9 }] } : {},
    );
    await repository.send(SEND);

    expect(calls[1].sql).toMatch(/UPDATE HMC_RHAP_OTP_tbl[\s\S]*WHERE SeqNo = @seqNo/);
    expect(calls[1].params.seqNo).toBe(9);
    expectRunnableOnMysql(calls);
  });

  it('refuses with 409 when a newer send replaced the request before activation', async () => {
    const { repository } = make((sql) =>
      /MAX\(SeqNo\)/.test(sql)
        ? { rows: [{ SeqNo: 9 }] }
        : /OTPStatus = '1'/.test(sql)
          ? { rowsAffected: 0 }
          : {},
    );
    await expect(repository.send(SEND)).rejects.toMatchObject({ status: 409 });
  });

  describe('verify()', () => {
    const VERIFY = {
      username: 'user',
      imei: 'device',
      requestId: 'r'.repeat(43),
      otp: '012345',
      purpose: 'ONBOARDING' as const,
    };

    it('spends a matching OTP and counts the attempt, under FOR UPDATE', async () => {
      const { repository, calls, transactions } = make((sql) =>
        /FOR UPDATE/.test(sql) ? { rows: [{ SeqNo: 9, Matched: 1 }] } : {},
      );
      await expect(repository.verify(VERIFY)).resolves.toBe(true);

      expect(transactions()).toBe(1);
      expect(calls[0].sql).toMatch(
        /CAST\(TRIM\(CAST\(OTPValue AS CHAR\(256\)\)\) AS BINARY\) = @otp/,
      );
      expect(calls[0].sql).not.toContain('RequestType');
      expect(calls[1].params).toEqual({ seqNo: 9, matched: 1 });
      expect(calls[1].sql).toMatch(/IFNULL\(OTPValidationAttemptCount, 0\) \+ 1/);
      expectRunnableOnMysql(calls);
    });

    it('counts a wrong code as an attempt without spending the OTP', async () => {
      const { repository, calls } = make((sql) =>
        /FOR UPDATE/.test(sql) ? { rows: [{ SeqNo: 9, Matched: 0 }] } : {},
      );
      await expect(repository.verify(VERIFY)).resolves.toBe(false);
      expect(calls[1].params).toEqual({ seqNo: 9, matched: 0 });
    });

    it.each([
      [[]],
      [
        [
          { SeqNo: 1, Matched: 1 },
          { SeqNo: 2, Matched: 1 },
        ],
      ],
    ])('rejects a missing or ambiguous request: %j', async (rows) => {
      const { repository } = make((sql) => (/FOR UPDATE/.test(sql) ? { rows } : {}));
      await expect(repository.verify(VERIFY)).resolves.toBe(false);
    });
  });
});
