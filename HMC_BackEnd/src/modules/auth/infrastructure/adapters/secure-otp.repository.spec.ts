import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { AuthStateService } from '@core/auth/auth-state.service';
import { MssqlService } from '@core/database/mssql.service';
import { safePreview } from '@core/logging/sensitive-data.util';
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
const storedId = (value: string) =>
  createHash('sha256').update(value).digest('hex').slice(0, 32).toUpperCase();

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

function assertExistingOtpSql(db: jest.Mocked<MssqlService>) {
  for (const [sql] of [...db.query.mock.calls, ...db.execute.mock.calls]) {
    expect(sql).toContain('HMC_RHAP_OTP_tbl');
    expect(sql).not.toMatch(
      /HMC_Sanad_(Auth\w*|EnrollmentGrant)_tbl|\b(CREATE|ALTER|DELETE|DROP)\b/i,
    );
    expect(sql).not.toMatch(/OtpHash|DeliveredAt|ConsumedAt|\bPurpose\b|\bExpiresAt\b/);
  }
}

describe('Existing-table secure OTP state', () => {
  it('keeps opaque wire IDs and maps them into the existing 32-character RequestId representation', async () => {
    const { repository, db, delivery } = makeRepository();
    const first = await repository.send(SEND);
    const second = await repository.send(SEND);
    expect(first.requestId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second.requestId).not.toBe(first.requestId);
    const [sql, params] = db.execute.mock.calls[0];
    expect(params).toMatchObject({
      username: 'TESTUSER',
      imei: SEND.imei,
      requestType: 'USER_REG',
      requestId: storedId(first.requestId),
      otp: '012345',
      sendMode: 'SMS',
    });
    expect(String(params!.requestId)).toMatch(/^[0-9A-F]{32}$/);
    expect(sql).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(sql).toContain('MAX(SeqNo)');
    expect(sql).toContain("OTPStatus = '0'");
    expect(sql).toContain('ROLLBACK');
    expect(safePreview(params)).toHaveProperty('otp', '******');
    expect(first).not.toHaveProperty('otp');
    expect(delivery.sendOtpSms).toHaveBeenCalledWith(
      '55550000',
      '012345',
      'ONBOARDING',
      'en',
      undefined,
    );
    expect(db.execute.mock.calls[1][0]).toContain("SET OTPStatus = '1'");
    expect(db.execute.mock.calls[1][1]).toMatchObject({
      requestId: storedId(first.requestId),
      requestType: 'USER_REG',
    });
    assertExistingOtpSql(db);
  });

  it('leaves the OTP unusable if delivery fails', async () => {
    const { repository, db, delivery } = makeRepository();
    delivery.sendOtpSms.mockRejectedValue(new Error('Delivery failed'));
    await expect(repository.send(SEND)).rejects.toThrow('Delivery failed');
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.execute.mock.calls[0][0]).toContain("OTPStatus = '0'");
  });

  it('does not activate an older request after another send has replaced it', async () => {
    const { repository, db } = makeRepository();
    db.execute
      .mockResolvedValueOnce({ rowsAffected: 1, rows: [] })
      .mockResolvedValueOnce({ rowsAffected: 0, rows: [] });
    await expect(repository.send(SEND)).rejects.toMatchObject({ status: 409 });
  });

  it('uses directory email when no phone exists', async () => {
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

  it('returns a dummy opaque ID without a usable row when no contact exists', async () => {
    const { repository, db, delivery, email } = makeRepository();
    await expect(repository.send({ ...SEND, phoneNumber: undefined })).resolves.toMatchObject({
      requestId: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(db.execute).not.toHaveBeenCalled();
    expect(delivery.sendOtpSms).not.toHaveBeenCalled();
    expect(email.sendOtpEmail).not.toHaveBeenCalled();
  });

  it.each([
    ['ONBOARDING', 'USER_REG'],
    ['FORGOT_MPIN', 'FORGET_MPIN'],
  ] as const)(
    'verifies %s through existing purpose/status/attempt/time columns',
    async (purpose, requestType) => {
      const { repository, db, state } = makeRepository();
      await expect(repository.verify({ ...VERIFY, purpose })).resolves.toBe(true);
      const [sql, params] = db.query.mock.calls[0];
      for (const predicate of [
        'LoginID = @username',
        'DeviceIMEINumber COLLATE Latin1_General_100_BIN2 = @imei',
        'RequestType = @requestType',
        "OTPStatus = '1'",
        'ISNULL(OTPValidationAttemptCount, 0) < @maximum',
        'OTPSentDateTime <= GETDATE()',
        'OTPSentDateTime > DATEADD(SECOND, -@ttl, GETDATE())',
      ])
        expect(sql).toContain(predicate);
      expect(sql).toContain('OTPValidationAttemptCount = ISNULL(OTPValidationAttemptCount, 0) + 1');
      expect(sql).toContain("THEN '0' ELSE OTPStatus END");
      expect(sql).not.toContain('NOLOCK');
      expect(params).toMatchObject({
        requestId: storedId(REQUEST_ID),
        username: 'TESTUSER',
        requestType,
        maximum: 5,
        ttl: 300,
        otp: '012345',
      });
      expect(state.limit).toHaveBeenCalledWith('otp-verify', 'TESTUSER', 5, 300);
      assertExistingOtpSql(db);
    },
  );

  it.each([
    { rows: [] },
    { rows: [{ Verified: 0 }] },
    { rows: [{ Verified: 1 }, { Verified: 1 }] },
  ])('rejects a missing, failed or ambiguous verification update: $rows', async ({ rows }) => {
    const { repository, db } = makeRepository();
    db.query.mockResolvedValue(rows);
    await expect(repository.verify(VERIFY)).resolves.toBe(false);
  });

  it('does not accept missing purpose or the old SeqNo as a request ID', async () => {
    const { repository, db } = makeRepository();
    await expect(repository.verify({ ...VERIFY, purpose: undefined })).resolves.toBe(false);
    await expect(repository.verify({ ...VERIFY, requestId: '42' })).resolves.toBe(false);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('propagates unavailable persistence rather than reporting verification success', async () => {
    const { repository, db } = makeRepository();
    db.query.mockRejectedValue(new Error('Unavailable'));
    await expect(repository.verify(VERIFY)).rejects.toThrow('Unavailable');
  });

  it('consults the durable OTP row again on another instance or after restart', async () => {
    const { repository, db, state, delivery, email, config } = makeRepository();
    await expect(repository.verify(VERIFY)).resolves.toBe(true);
    db.query.mockResolvedValue([]);
    await expect(
      new SecureOtpRepository(db, state, delivery, email, config).verify(VERIFY),
    ).resolves.toBe(false);
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});
