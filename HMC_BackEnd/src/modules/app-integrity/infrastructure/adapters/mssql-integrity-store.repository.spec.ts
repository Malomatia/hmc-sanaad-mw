import { ServiceUnavailableException } from '@nestjs/common';
import { MssqlService } from '@core/database/mssql.service';
import { MssqlAttestKeyStore, MssqlChallengeStore } from './mssql-integrity-store.repository';

describe('MssqlChallengeStore', () => {
  const execute = jest.fn();
  const store = new MssqlChallengeStore({ execute } as unknown as MssqlService, 300000);

  /** `issue` also sweeps expired rows, so the INSERT is not always call 0. */
  const call = (fragment: string): [string, Record<string, unknown>] => {
    const found = execute.mock.calls.find(([sql]: [string]) => sql.includes(fragment));
    if (!found) throw new Error(`no statement containing ${fragment}`);
    return found as [string, Record<string, unknown>];
  };

  beforeEach(() => {
    execute.mockReset().mockResolvedValue({ rowsAffected: 1, rows: [] });
  });

  it('persists the supplied deviceId in the existing LoginID column using bound values', async () => {
    const deviceId = "mobile-device'123";
    const challenge = await store.issue(deviceId);
    const [sql, params] = call('INSERT INTO');

    expect(Buffer.from(challenge, 'base64')).toHaveLength(32);
    expect(sql).toContain('(Challenge, LoginID, IssuedAt, ExpiresAt)');
    expect(sql).toContain(
      'VALUES (@value, @deviceId, GETDATE(), DATEADD(millisecond, @ttl, GETDATE()))',
    );
    expect(sql).not.toContain('DeviceID');
    expect(sql).not.toContain(deviceId);
    expect(params).toEqual({ value: challenge, deviceId, ttl: 300000 });
    expect(await store.issue(deviceId)).not.toBe(challenge);
  });

  it.each([
    'INSERT permission denied',
    "Invalid object name 'HMC_Sanad_AttestChallenge_tbl'.",
    'Database unavailable',
  ])('does not return an unusable nonce when persistence fails: %s', async (message) => {
    execute.mockRejectedValueOnce(new Error(message));
    await expect(store.issue('device-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('does not return a challenge if no row was inserted', async () => {
    execute.mockResolvedValueOnce({ rowsAffected: 0, rows: [] });
    await expect(store.issue('device-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('sweeps long-expired challenges once per interval, in a capped batch', async () => {
    // Every app launch issues one and `consume` only filters them out, so
    // without this the table grows forever.
    const fresh = new MssqlChallengeStore({ execute } as unknown as MssqlService, 300000);

    await fresh.issue('device-1');
    const [sql, params] = call('DELETE');
    expect(sql).toContain('DELETE TOP (@batch)');
    expect(sql).toContain('WHERE ExpiresAt < DATEADD(hour, -@graceHours, GETDATE())');
    expect(params).toEqual({ batch: 5000, graceHours: 24 });

    // A second issue in the same interval must not delete again.
    execute.mockClear();
    await fresh.issue('device-1');
    expect(execute.mock.calls.filter(([s]: [string]) => s.includes('DELETE'))).toHaveLength(0);
  });

  it('still issues a challenge when the sweep fails', async () => {
    const fresh = new MssqlChallengeStore({ execute } as unknown as MssqlService, 300000);
    execute.mockRejectedValueOnce(new Error('DELETE permission denied'));

    await expect(fresh.issue('device-1')).resolves.toEqual(expect.any(String));
  });

  it('preserves the atomic single-use and expiration checks without requiring an identity', async () => {
    execute.mockResolvedValueOnce({ rowsAffected: 1, rows: [] });
    execute.mockResolvedValueOnce({ rowsAffected: 0, rows: [] });

    await expect(store.consume('one-time-challenge')).resolves.toBe(true);
    await expect(store.consume('one-time-challenge')).resolves.toBe(false);
    const [sql, params] = call('UPDATE');
    expect(sql).toContain('SET UsedAt = GETDATE()');
    expect(sql).toContain('WHERE Challenge = @value AND UsedAt IS NULL AND ExpiresAt > GETDATE()');
    expect(sql).not.toContain('LoginID');
    expect(params).toEqual({ value: 'one-time-challenge' });
  });

  it('ties consumption to the issuing device in the SAME statement when asked', async () => {
    // Anonymous registration has no user linking the two calls; the device
    // predicate must be atomic with the spend, not a separate read.
    await store.consume('one-time-challenge', 'mobile-installation-1');

    const [sql, params] = call('UPDATE');
    expect(sql).toMatch(/UsedAt IS NULL AND ExpiresAt > GETDATE\(\) AND LoginID = @deviceId/);
    expect(sql).not.toContain('mobile-installation-1');
    expect(params).toEqual({ value: 'one-time-challenge', deviceId: 'mobile-installation-1' });
  });
});

describe('MssqlAttestKeyStore', () => {
  const execute = jest.fn();
  const store = new MssqlAttestKeyStore({ execute } as unknown as MssqlService);

  beforeEach(() => {
    execute.mockReset().mockResolvedValue({ rowsAffected: 1, rows: [] });
  });

  it('claims a key for a user with bound values only', async () => {
    await store.bind("key'1", 'AIBRAHIM39');

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/UPDATE HMC_Sanad_AttestKey_tbl SET LoginID = @username, UpdatedAt = GETDATE\(\)\s+WHERE KeyID = @keyId/);
    expect(sql).not.toContain('AIBRAHIM39');
    expect(params).toEqual({ keyId: "key'1", username: 'AIBRAHIM39' });
  });

  it('never lowers a sign counter, so a replayed assertion cannot rewind it', async () => {
    // Two assertions racing: the higher counter must survive whichever
    // statement lands second, and a captured older one must not overwrite it.
    await store.updateSignCount('key-1', 42);

    const [sql, params] = execute.mock.calls[0];
    expect(sql).toMatch(/WHERE KeyID = @keyId AND SignCount < @signCount/);
    expect(params).toEqual({ keyId: 'key-1', signCount: 42 });
  });

  it('treats a missing table as "cannot record", not a crash', async () => {
    execute.mockRejectedValueOnce(new Error("Invalid object name 'HMC_Sanad_AttestKey_tbl'."));
    await expect(store.bind('k1', 'AIBRAHIM39')).resolves.toBeUndefined();
  });
});
