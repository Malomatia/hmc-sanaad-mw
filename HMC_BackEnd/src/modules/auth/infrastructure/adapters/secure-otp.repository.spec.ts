import { ConfigService } from '@nestjs/config';
import { AuthStateService } from '@core/auth/auth-state.service';
import { MssqlService } from '@core/database/mssql.service';
import { SecureOtpRepository } from './secure-otp.repository';
import { VerifyOtpCommand } from '../../domain/ports/otp.port';

const SEND = {
  username: 'testuser',
  imei: 'device-1',
  phoneNumber: '55550000',
  purpose: 'ONBOARDING' as const,
};
const REQUEST_ID = 'r'.repeat(43);
const VERIFY: VerifyOtpCommand = {
  username: SEND.username,
  imei: SEND.imei,
  requestId: REQUEST_ID,
  otp: '012345',
  purpose: 'ONBOARDING',
};

function makeRepository() {
  const db = {
    query: jest.fn().mockResolvedValue([{ Verified: 1 }]),
    execute: jest.fn().mockResolvedValue({ rowsAffected: 1, rows: [] }),
  } as unknown as jest.Mocked<MssqlService>;
  const state = {
    limit: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuthStateService>;
  const delivery = { sendOtpSms: jest.fn().mockResolvedValue(undefined) };
  const email = { sendOtpEmail: jest.fn().mockResolvedValue(undefined) };
  const config = new ConfigService({
    auth: { jwtSecret: 'test-only-secret-material-at-least-32-bytes' },
    otp: {
      length: 6,
      ttlSeconds: 300,
      maxAttempts: 5,
      staticValue: '012345',
      charset: 'numeric',
      inResponse: false,
    },
  });
  return {
    repository: new SecureOtpRepository(db, state, delivery, email, config),
    db,
    state,
    delivery,
    email,
    config,
  };
}

describe('Secure OTP state', () => {
  it('uses an opaque fresh request ID, stores only a keyed digest, and invalidates older same-purpose challenges', async () => {
    const { repository, db, delivery } = makeRepository();
    const first = await repository.send(SEND);
    const second = await repository.send(SEND);
    expect(first.requestId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.requestId).not.toBe(first.requestId);
    const [sql, params] = db.execute.mock.calls[0];
    expect(sql).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(sql).toContain('Purpose = @purpose');
    expect(sql).toContain('ROLLBACK');
    expect(params).toMatchObject({
      username: 'TESTUSER',
      imei: SEND.imei,
      purpose: 'ONBOARDING',
      otpHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(params).not.toHaveProperty('otp');
    expect(first).not.toHaveProperty('otp');
    expect(delivery.sendOtpSms).toHaveBeenCalledWith(
      '55550000',
      '012345',
      'ONBOARDING',
      'en',
      undefined,
    );
    expect(db.execute.mock.calls[1][0]).toContain('DeliveredAt = SYSUTCDATETIME()');
  });

  it('does not activate a challenge when delivery fails', async () => {
    const { repository, db, delivery } = makeRepository();
    delivery.sendOtpSms.mockRejectedValue(new Error('Delivery failed'));
    await expect(repository.send(SEND)).rejects.toThrow('Delivery failed');
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('uses email only when the directory has no phone', async () => {
    const { repository, email, delivery } = makeRepository();
    await expect(
      repository.send({
        ...SEND,
        phoneNumber: undefined,
        email: 'employee@example.test',
        lang: 'ar',
      }),
    ).resolves.toMatchObject({ mode: 'Email' });
    expect(email.sendOtpEmail).toHaveBeenCalledWith(
      'employee@example.test',
      '012345',
      'ONBOARDING',
      'ar',
    );
    expect(delivery.sendOtpSms).not.toHaveBeenCalled();
  });

  it('returns an indistinguishable opaque ID without recording a usable OTP if no destination exists', async () => {
    const { repository, db, delivery, email } = makeRepository();
    await expect(repository.send({ ...SEND, phoneNumber: undefined })).resolves.toMatchObject({
      requestId: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(db.execute).not.toHaveBeenCalled();
    expect(delivery.sendOtpSms).not.toHaveBeenCalled();
    expect(email.sendOtpEmail).not.toHaveBeenCalled();
  });

  it('checks user, device, purpose, delivery, expiry, attempts and consumption in one conditional update', async () => {
    const { repository, db, state } = makeRepository();
    await expect(repository.verify(VERIFY)).resolves.toBe(true);
    const [sql, params] = db.query.mock.calls[0];
    for (const predicate of [
      'LoginID = @username',
      'DeviceIMEI = @imei',
      'Purpose = @purpose',
      'ExpiresAt > SYSUTCDATETIME()',
      'DeliveredAt IS NOT NULL',
      'ConsumedAt IS NULL',
      'Attempts < @maximum',
    ]) {
      expect(sql).toContain(predicate);
    }
    expect(sql).toContain('Attempts = Attempts + 1');
    expect(sql).not.toContain('NOLOCK');
    expect(params).toMatchObject({
      requestId: REQUEST_ID,
      username: 'TESTUSER',
      purpose: 'ONBOARDING',
      maximum: 5,
    });
    expect(state.limit).toHaveBeenCalledWith('otp-verify', 'TESTUSER', 5, 300);
  });

  it.each([{ rows: [] }, { rows: [{ Verified: 0 }] }])(
    'rejects when the authoritative update returns $rows',
    async ({ rows }) => {
      const { repository, db } = makeRepository();
      db.query.mockResolvedValue(rows);
      await expect(repository.verify(VERIFY)).resolves.toBe(false);
    },
  );

  it('requires purpose and a fresh opaque ID before querying verification state', async () => {
    const { repository, db } = makeRepository();
    await expect(repository.verify({ ...VERIFY, purpose: undefined })).resolves.toBe(false);
    await expect(repository.verify({ ...VERIFY, requestId: '42' })).resolves.toBe(false);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('does not treat unavailable persistence as a successful verification', async () => {
    const { repository, db } = makeRepository();
    db.query.mockRejectedValue(new Error('Unavailable'));
    await expect(repository.verify(VERIFY)).rejects.toThrow('Unavailable');
  });

  it('consults durable state again after a process restart instead of a local consumed set', async () => {
    const { repository, db, state, delivery, email, config } = makeRepository();
    await expect(repository.verify(VERIFY)).resolves.toBe(true);
    db.query.mockResolvedValue([]);
    const restarted = new SecureOtpRepository(db, state, delivery, email, config);
    await expect(restarted.verify(VERIFY)).resolves.toBe(false);
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});
