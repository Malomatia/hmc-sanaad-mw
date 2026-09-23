import { ServiceUnavailableException } from '@nestjs/common';
import { MssqlService } from '@core/database/mssql.service';
import { MssqlChallengeStore } from './mssql-integrity-store.repository';

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
    expect(params).toEqual({ value: 'one-time-challenge' });
  });
});
