import { ServiceUnavailableException } from '@nestjs/common';
import { MssqlService } from '@core/database/mssql.service';
import { MssqlAttestKeyStore, MssqlChallengeStore } from './mssql-integrity-store.repository';

describe('MssqlChallengeStore', () => {
  const execute = jest.fn();
  const store = new MssqlChallengeStore({ execute } as unknown as MssqlService, 300000);

  beforeEach(() => {
    execute.mockReset().mockResolvedValue({ rowsAffected: 1, rows: [] });
  });

  it('persists the supplied deviceId in the existing LoginID column using bound values', async () => {
    const deviceId = "mobile-device'123";
    const challenge = await store.issue(deviceId);
    const [sql, params] = execute.mock.calls[0];

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

  it('preserves the atomic single-use and expiration checks without requiring an identity', async () => {
    execute.mockResolvedValueOnce({ rowsAffected: 1, rows: [] });
    execute.mockResolvedValueOnce({ rowsAffected: 0, rows: [] });

    await expect(store.consume('one-time-challenge')).resolves.toBe(true);
    await expect(store.consume('one-time-challenge')).resolves.toBe(false);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain('SET UsedAt = GETDATE()');
    expect(sql).toContain('WHERE Challenge = @value AND UsedAt IS NULL AND ExpiresAt > GETDATE()');
    expect(sql).not.toContain('LoginID');
    expect(params).toEqual({ value: 'one-time-challenge' });
  });

  it('ties consumption to the issuing device in the SAME statement when asked', async () => {
    // Anonymous registration has no user linking the two calls; the device
    // predicate must be atomic with the spend, not a separate read.
    await store.consume('one-time-challenge', 'mobile-installation-1');

    const [sql, params] = execute.mock.calls[0];
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

  it('treats a missing table as "cannot record", not a crash', async () => {
    execute.mockRejectedValueOnce(new Error("Invalid object name 'HMC_Sanad_AttestKey_tbl'."));
    await expect(store.bind('k1', 'AIBRAHIM39')).resolves.toBeUndefined();
  });
});
