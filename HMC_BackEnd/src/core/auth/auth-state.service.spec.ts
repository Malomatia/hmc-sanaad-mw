import { ConfigService } from '@nestjs/config';
import { MssqlService } from '../database/mssql.service';
import { AuthStateService } from './auth-state.service';
import { MssqlChallengeStore } from '@modules/app-integrity/infrastructure/adapters/mssql-integrity-store.repository';

const config = new ConfigService({
  auth: { jwtSecret: 'test-shared-nonce-key-never-used-in-production' },
});
const future = () => new Date(Date.now() + 3600000);
function makeState() {
  const db = {
    query: jest.fn().mockResolvedValue([{ Updated: 1, Created: 1, Rotated: 1, Allowed: 1 }]),
    execute: jest.fn().mockResolvedValue({ rowsAffected: 1, rows: [] }),
  } as unknown as jest.Mocked<MssqlService>;
  return { state: new AuthStateService(db, config), db };
}

function assertSupportedSql(db: jest.Mocked<MssqlService>) {
  for (const [sql] of [...db.query.mock.calls, ...db.execute.mock.calls]) {
    expect(sql).not.toMatch(/HMC_Sanad_(Auth\w*|EnrollmentGrant)_tbl/);
    expect(sql).not.toMatch(/\b(CREATE|ALTER|DELETE|DROP)\b/i);
    const tables = [...sql.matchAll(/\b(?:FROM|INTO|UPDATE)\s+(HMC_\w+)/g)].map(
      (match) => match[1],
    );
    expect(tables.length).toBeGreaterThan(0);
    expect(
      tables.every((table) =>
        ['HMC_Sanad_AttestChallenge_tbl', 'HMC_Sanad_DeviceRegn_tbl'].includes(table),
      ),
    ).toBe(true);
  }
}

describe('Existing-table shared authentication state', () => {
  it('uses only the existing challenge table for shared budgets and enrollment proofs', async () => {
    const { state, db } = makeState();
    await state.limit('login', 'TESTUSER', 5, 900);
    await state.issueEnrollment('TESTUSER', 'device');
    assertSupportedSql(db);
    for (const [sql] of [...db.query.mock.calls, ...db.execute.mock.calls]) {
      expect(sql).toContain('HMC_Sanad_AttestChallenge_tbl');
    }
  });

  it('stores a namespaced, user/device-bound digest instead of the raw enrollment token', async () => {
    const { state, db } = makeState();
    const token = await state.issueEnrollment('testuser', 'device');
    const [sql, params] = db.execute.mock.calls[0];
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sql).toContain('(Challenge, LoginID, IssuedAt, ExpiresAt, UsedAt)');
    expect(params).toMatchObject({
      username: 'TESTUSER',
      ttl: 300,
      grantTokenKey: expect.stringMatching(/^hG\.[A-Za-z0-9_-]{40}$/),
    });
    expect(JSON.stringify(params)).not.toContain(token);
  });

  it('lets another instance consume the same grant once through the shared conditional update', async () => {
    const { state, db } = makeState();
    const token = await state.issueEnrollment('testuser', 'device');
    const key = db.execute.mock.calls[0][1]!.grantTokenKey;
    let used = false;
    db.query.mockImplementation(async (_sql, params) => {
      const success = !used && params?.grantTokenKey === key;
      if (success) used = true;
      return [{ Updated: success ? 1 : 0 }];
    });
    const other = new AuthStateService(db, config);
    await expect(other.enroll('OTHER', 'device', 'hash', token)).resolves.toBe(false);
    await expect(other.enroll('testuser', 'OTHER-DEVICE', 'hash', token)).resolves.toBe(false);
    const results = await Promise.all([
      state.enroll('testuser', 'device', 'hash', token),
      other.enroll('TESTUSER', 'device', 'hash', token),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const sql = db.query.mock.calls[0][0];
    for (const text of [
      'BEGIN TRANSACTION',
      'UPDLOCK, HOLDLOCK',
      'UsedAt IS NULL',
      'ExpiresAt > GETDATE()',
      'MPIN IS NULL',
      "Status = 'Inactive'",
      'IF @claimed = 1',
      'ROLLBACK',
    ])
      expect(sql).toContain(text);
    assertSupportedSql(db);
  });

  it('refuses malformed grants without SQL', async () => {
    const { state, db } = makeState();
    await expect(state.enroll('testuser', 'device', 'hash', '')).resolves.toBe(false);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("invalidates only this user's authentication nonces when resetting a credential", async () => {
    const { state, db } = makeState();
    await expect(state.resetMpin('testuser', 'device', 'hash')).resolves.toBe(true);
    const sql = db.query.mock.calls[0][0];
    expect(sql).toContain("Status = 'Active' AND MPIN IS NOT NULL");
    expect(sql).toContain('IF @updated = 1');
    for (const prefix of ['hF.', 'hA.', 'hR.', 'hG.']) expect(sql).toContain(`LIKE '${prefix}%'`);
    expect(sql).not.toContain("LIKE 'hB.%'");
    assertSupportedSql(db);
  });

  it('creates family/access/refresh nonces only after rechecking the active MPIN', async () => {
    const { state, db } = makeState();
    const session = state.newSession('testuser', 'device', future());
    await state.createSession(session, 'hash');
    expect(db.query.mock.calls[0][0]).toContain("MPIN = @mpin AND Status = 'Active'");
    expect(db.query.mock.calls[0][1]).toMatchObject({
      username: 'TESTUSER',
      mpin: 'hash',
      familyTokenKey: expect.stringMatching(/^hF\./),
      accessTokenKey: expect.stringMatching(/^hA\./),
      refreshTokenKey: expect.stringMatching(/^hR\./),
    });
    db.query.mockResolvedValue([{ Created: 0 }]);
    await expect(state.createSession(session, 'wrong')).rejects.toThrow('Invalid credentials');
    assertSupportedSql(db);
  });

  it('uses identical family/access keys on another instance and after restart', async () => {
    const { state, db } = makeState();
    const session = state.newSession('testuser', 'device', future());
    await state.createSession(session, 'hash');
    const inserted = db.query.mock.calls[0][1]!;
    db.query.mockResolvedValue([{ Active: 1 }]);
    const other = new AuthStateService(db, config);
    await expect(
      other.sessionActive(session.sid, 'TESTUSER', 'device', session.accessId),
    ).resolves.toBe(true);
    expect(db.query.mock.calls[1][1]).toMatchObject({
      familyTokenKey: inserted.familyTokenKey,
      accessTokenKey: inserted.accessTokenKey,
    });
    expect(db.query.mock.calls[1][0]).toContain("D.Status = 'Active'");
    db.query.mockResolvedValue([]);
    await expect(
      new AuthStateService(db, config).sessionActive(
        session.sid,
        'testuser',
        'device',
        session.accessId,
      ),
    ).resolves.toBe(false);
    assertSupportedSql(db);
  });

  it('rotates one refresh nonce and retires its paired access nonce without another JWT claim', async () => {
    const { state, db } = makeState();
    const first = state.newSession('testuser', 'device', future());
    await state.createSession(first, 'hash');
    const inserted = db.query.mock.calls[0][1]!;
    const other = new AuthStateService(db, config);
    const next = { ...other.newSession('testuser', 'device', future()), sid: first.sid };
    await other.rotateSession(next, first.refreshId);
    expect(db.query.mock.calls[1][1]).toMatchObject({
      familyTokenKey: inserted.familyTokenKey,
      previousRefreshTokenKey: inserted.refreshTokenKey,
      previousAccessTokenKey: inserted.accessTokenKey,
    });
    const sql = db.query.mock.calls[1][0];
    expect(sql).toContain('IF @claimed = 1');
    expect(sql).toContain('IF @rotated = 0');
    expect(sql).toContain('SET UsedAt = @now');
    db.query.mockResolvedValue([{ Rotated: 0 }]);
    await expect(other.rotateSession(next, first.refreshId)).rejects.toThrow('no longer valid');
    assertSupportedSql(db);
  });

  it('revokes the exact family from any instance without deleting records', async () => {
    const { state, db } = makeState();
    const session = state.newSession('testuser', 'device', future());
    await state.createSession(session, 'hash');
    await new AuthStateService(db, config).revokeSession(session.sid, 'TESTUSER', 'device');
    expect(db.execute.mock.calls[0][1]).toMatchObject({
      familyTokenKey: db.query.mock.calls[0][1]!.familyTokenKey,
    });
    expect(db.execute.mock.calls[0][0]).toContain('SET UsedAt = GETDATE()');
    assertSupportedSql(db);
  });

  it('shares scoped rate budgets across instances, bounds key length and retains Retry-After', async () => {
    const { state, db } = makeState();
    await state.limit('login', 'testuser', 5, 900);
    db.query.mockResolvedValue([{ Allowed: 0, RetryAfterSeconds: 45 }]);
    await expect(
      new AuthStateService(db, config).limit('login', 'TESTUSER', 5, 900),
    ).rejects.toMatchObject({ status: 429 });
    expect(db.query.mock.calls[1][1]!.bucketTokenPrefix).toBe(
      db.query.mock.calls[0][1]!.bucketTokenPrefix,
    );
    expect(String(db.query.mock.calls[0][1]!.rateTokenKey)).toHaveLength(43);
    const sql = db.query.mock.calls[0][0];
    expect(sql).toContain('UPDLOCK, HOLDLOCK');
    expect(sql).toContain("ESCAPE '~'");
    expect(sql).toContain('IF @attempts < @maximum');
    expect(sql).not.toContain('UsedAt IS NULL');
    assertSupportedSql(db);
  });

  it('fails closed on an unavailable existing store', async () => {
    const { state, db } = makeState();
    db.query.mockRejectedValue(new Error('Unavailable'));
    await expect(state.limit('login', 'testuser', 5, 900)).rejects.toThrow('Unavailable');
    await expect(state.sessionActive('sid', 'testuser', 'device')).rejects.toThrow('Unavailable');
  });
});

describe('App Attest namespace isolation', () => {
  it.each(['hF.', 'hA.', 'hR.', 'hG.', 'hB.'])(
    'does not consume an authentication nonce with prefix %s',
    async (prefix) => {
      const { db } = makeState();
      await expect(
        new MssqlChallengeStore(db, 300000).consume(prefix + 'x'.repeat(40)),
      ).resolves.toBe(false);
      expect(db.execute).not.toHaveBeenCalled();
    },
  );

  it('still issues and consumes its original canonical 32-byte base64 challenges', async () => {
    const { db } = makeState();
    const store = new MssqlChallengeStore(db, 300000);
    const value = await store.issue('TESTUSER');
    expect(value).toHaveLength(44);
    await expect(store.consume(value)).resolves.toBe(true);
    expect(db.execute.mock.calls[1][0]).toContain(
      'Challenge COLLATE Latin1_General_100_BIN2 = @value',
    );
  });
});
