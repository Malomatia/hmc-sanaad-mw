import { MssqlService } from '../database/mssql.service';
import { AuthStateService } from './auth-state.service';

function makeState() {
  const db = {
    query: jest.fn().mockResolvedValue([{ Updated: 1 }]),
    execute: jest.fn().mockResolvedValue({ rowsAffected: 1, rows: [] }),
  } as unknown as jest.Mocked<MssqlService>;
  return { state: new AuthStateService(db), db };
}

describe('Shared authentication state', () => {
  it('bounds cleanup to expired records in the four new security-state tables only', async () => {
    const { state, db } = makeState();
    await state.pruneExpired();
    const sql = db.execute.mock.calls[0][0];
    expect(sql.match(/DELETE TOP \(500\)/g)).toHaveLength(4);
    expect(sql.match(/WHERE ExpiresAt < SYSUTCDATETIME\(\)/g)).toHaveLength(4);
    expect(sql).not.toContain('DeviceRegn');
    expect(sql).not.toContain('HMC_RHAP_OTP');
  });

  it('stores only the hash of a short-lived enrollment grant', async () => {
    const { state, db } = makeState();
    const grant = await state.issueEnrollment('testuser', 'device');
    expect(grant).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [sql, params] = db.execute.mock.calls[0];
    expect(sql).toContain('DATEADD(SECOND, @ttl, SYSUTCDATETIME())');
    expect(params).toMatchObject({ username: 'TESTUSER', imei: 'device', ttl: 300 });
    expect(JSON.stringify(params)).not.toContain(grant);
  });

  it('consumes authorization and writes only a unique inactive first registration in one transaction', async () => {
    const { state, db } = makeState();
    await expect(state.enroll('testuser', 'device', 'client-hash', 'g'.repeat(43))).resolves.toBe(
      true,
    );
    const [sql, params] = db.query.mock.calls[0];
    for (const text of [
      'BEGIN TRANSACTION',
      'TokenHash = @tokenHash',
      'LoginID = @username',
      'DeviceIMEI = @imei',
      'ConsumedAt IS NULL',
      'ExpiresAt > SYSUTCDATETIME()',
      'MPIN IS NULL',
      "Status = 'Inactive'",
      'UPDLOCK, HOLDLOCK',
      'ROLLBACK',
    ])
      expect(sql).toContain(text);
    expect(sql).not.toContain('INSERT INTO HMC_Sanad_DeviceRegn_tbl');
    expect(params).toMatchObject({ username: 'TESTUSER', imei: 'device', mpin: 'client-hash' });
  });

  it('rejects malformed grants without a database call', async () => {
    const { state, db } = makeState();
    await expect(state.enroll('testuser', 'device', 'hash', '')).resolves.toBe(false);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects a consumed/expired/mismatched grant when the store updates no registration', async () => {
    const { state, db } = makeState();
    db.query.mockResolvedValue([{ Updated: 0 }]);
    await expect(state.enroll('testuser', 'device', 'hash', 'g'.repeat(43))).resolves.toBe(false);
  });

  it('updates a recovery MPIN and revokes all user sessions and enrollment grants atomically', async () => {
    const { state, db } = makeState();
    await expect(state.resetMpin('testuser', 'device', 'opaque-hash')).resolves.toBe(true);
    const [sql] = db.query.mock.calls[0];
    expect(sql).toContain('BEGIN TRANSACTION');
    expect(sql).toContain("Status = 'Active' AND MPIN IS NOT NULL");
    expect(sql).toContain('UPDATE HMC_Sanad_AuthSession_tbl SET RevokedAt');
    expect(sql).toContain('UPDATE HMC_Sanad_EnrollmentGrant_tbl SET ConsumedAt');
    expect(sql).toContain('IF @updated = 1');
  });

  it('rechecks MPIN and active registration during session creation', async () => {
    const { state, db } = makeState();
    const session = state.newSession('testuser', 'device', new Date());
    await state.createSession(session, 'client-hash');
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("MPIN = @mpin AND Status = 'Active'"),
      expect.objectContaining({ mpin: 'client-hash', username: 'TESTUSER' }),
    );
    db.execute.mockResolvedValue({ rowsAffected: 0, rows: [] });
    await expect(state.createSession(session, 'old-hash')).rejects.toThrow('Invalid credentials');
  });

  it('uses shared state and active device checks for every protected request', async () => {
    const { state, db } = makeState();
    db.query.mockResolvedValue([{ Active: 1 }]);
    await expect(state.sessionActive('session', 'testuser', 'device', 'access')).resolves.toBe(
      true,
    );
    db.query.mockResolvedValue([]);
    await expect(
      new AuthStateService(db).sessionActive('session', 'testuser', 'device', 'access'),
    ).resolves.toBe(false);
    expect(db.query.mock.calls[0][0]).toContain('S.AccessId = @accessId');
    expect(db.query.mock.calls[0][0]).toContain("D.Status = 'Active'");
  });

  it('atomically rotates a matching refresh ID and revokes the family on reuse', async () => {
    const { state, db } = makeState();
    const session = state.newSession('testuser', 'device', new Date());
    await state.rotateSession(session, 'previous');
    expect(db.execute.mock.calls[0][0]).toContain('RefreshId = @previousRefreshId');
    expect(db.execute.mock.calls[0][1]).toMatchObject({
      previousRefreshId: 'previous',
      refreshId: session.refreshId,
    });
    db.execute.mockResolvedValueOnce({ rowsAffected: 0, rows: [] });
    await expect(state.rotateSession(session, 'previous')).rejects.toThrow('no longer valid');
    expect(db.execute.mock.calls[2][0]).toContain('SET RevokedAt = SYSUTCDATETIME()');
  });

  it('uses a shared atomic budget, rejects exhaustion, and never ignores storage failure', async () => {
    const { state, db } = makeState();
    db.query.mockResolvedValueOnce([{ Allowed: 1 }]).mockResolvedValueOnce([{ Allowed: 0 }]);
    await state.limit('login', 'TESTUSER', 5, 900);
    expect(db.query.mock.calls[0][0]).toContain('UPDLOCK, HOLDLOCK');
    await expect(state.limit('login', 'TESTUSER', 5, 900)).rejects.toMatchObject({ status: 429 });
    db.query.mockRejectedValue(new Error('Unavailable'));
    await expect(state.limit('login', 'TESTUSER', 5, 900)).rejects.toThrow('Unavailable');
  });
});
