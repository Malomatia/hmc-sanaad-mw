import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MssqlService } from '@core/database/mssql.service';
import { OtpConfig } from '@core/config/configuration';
import { MssqlOtpRepository } from './mssql-otp.repository';
import { OtpDeliveryPort } from '../../domain/ports/otp-delivery.port';

const OTP_CFG: OtpConfig = {
  length: 6,
  ttlSeconds: 300,
  maxAttempts: 3,
  resendWindowSeconds: 60,
  staticValue: '',
  charset: 'numeric',
  delivery: 'motc',
  store: 'legacy',
};

function makeRepo(cfg: Partial<OtpConfig> = {}) {
  const db = { query: jest.fn(), execute: jest.fn() } as unknown as jest.Mocked<MssqlService>;
  const delivery: jest.Mocked<OtpDeliveryPort> = {
    sendOtpSms: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    getOrThrow: jest.fn().mockReturnValue({ ...OTP_CFG, ...cfg }),
  } as unknown as ConfigService;
  const repo = new MssqlOtpRepository(db, delivery, config);
  return { repo, db, delivery };
}

const SEND = {
  username: 'hmc1',
  phoneNumber: '77861234',
  imei: 'imei-1',
  purpose: 'ONBOARDING' as const,
};

describe('MssqlOtpRepository', () => {
  describe('send', () => {
    it('stores a new OTP row and delivers it by SMS', async () => {
      const { repo, db, delivery } = makeRepo();
      db.query.mockResolvedValue([]); // no previous OTP
      db.execute.mockResolvedValue({ rowsAffected: 1, rows: [{ SeqNo: 42 }] });

      const result = await repo.send(SEND);

      expect(result.requestId).toBe('42');
      expect(db.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO HMC_RHAP_OTP_tbl'),
        expect.objectContaining({
          username: 'hmc1',
          imei: 'imei-1',
          otp: expect.stringMatching(/^\d{6}$/),
          requestId: expect.stringMatching(/^[0-9A-F]{32}$/),
          appName: 'Sanaad',
          appVersion: '1.0.0',
          appDatetime: expect.any(Date),
          requestType: 'USER_REG',
        }),
      );
      const otp = (db.execute.mock.calls[0][1] as { otp: string }).otp;
      expect(delivery.sendOtpSms).toHaveBeenCalledWith('77861234', otp, 'ONBOARDING');
    });

    it('rejects a resend inside the resend window with 429', async () => {
      const { repo, db, delivery } = makeRepo();
      db.query.mockResolvedValue([{ SeqNo: 41, DiffInSeconds: 30, OTPValue: '111111' }]);

      await expect(repo.send(SEND)).rejects.toMatchObject({ status: 429 });
      expect(db.execute).not.toHaveBeenCalled();
      expect(delivery.sendOtpSms).not.toHaveBeenCalled();
    });

    it('allows a resend once the window elapsed', async () => {
      const { repo, db } = makeRepo();
      db.query.mockResolvedValue([{ SeqNo: 41, DiffInSeconds: 61, OTPValue: '111111' }]);
      db.execute.mockResolvedValue({ rowsAffected: 1, rows: [{ SeqNo: 42 }] });

      await expect(repo.send(SEND)).resolves.toEqual({ requestId: '42' });
    });

    it('rejects when the user has no phone number', async () => {
      const { repo, db } = makeRepo();
      db.query.mockResolvedValue([]);

      await expect(repo.send({ ...SEND, phoneNumber: undefined })).rejects.toBeInstanceOf(
        HttpException,
      );
      expect(db.execute).not.toHaveBeenCalled();
    });
  });

  describe('verify', () => {
    const row = (overrides = {}) => [
      { SeqNo: 42, DiffInSeconds: 10, OTPValue: '123456', ...overrides },
    ];
    const VERIFY = { username: 'hmc1', imei: 'imei-1', requestId: '42', otp: '123456' };

    it('accepts the right OTP for the issued request', async () => {
      const { repo, db } = makeRepo();
      db.query.mockResolvedValue(row());

      await expect(repo.verify(VERIFY)).resolves.toBe(true);
    });

    it('is single-use: a verified OTP cannot be replayed', async () => {
      const { repo, db } = makeRepo();
      db.query.mockResolvedValue(row());

      await expect(repo.verify(VERIFY)).resolves.toBe(true);
      await expect(repo.verify(VERIFY)).resolves.toBe(false);
    });

    it('rejects an expired OTP', async () => {
      const { repo, db } = makeRepo();
      db.query.mockResolvedValue(row({ DiffInSeconds: 301 }));

      await expect(repo.verify(VERIFY)).resolves.toBe(false);
    });

    it('rejects a requestId that is not the latest issued OTP', async () => {
      const { repo, db } = makeRepo();
      db.query.mockResolvedValue(row());

      await expect(repo.verify({ ...VERIFY, requestId: '41' })).resolves.toBe(false);
    });

    it('locks the request after maxAttempts wrong codes', async () => {
      const { repo, db } = makeRepo();
      db.query.mockResolvedValue(row());

      for (let i = 0; i < 3; i++) {
        await expect(repo.verify({ ...VERIFY, otp: '000000' })).resolves.toBe(false);
      }
      // even the correct OTP is now refused
      await expect(repo.verify(VERIFY)).resolves.toBe(false);
    });

    it('compares numeric OTPValue columns as strings', async () => {
      const { repo, db } = makeRepo();
      db.query.mockResolvedValue(row({ OTPValue: 123456 }));

      await expect(repo.verify(VERIFY)).resolves.toBe(true);
    });

    it('rejects when no OTP row exists', async () => {
      const { repo, db } = makeRepo();
      db.query.mockResolvedValue([]);

      await expect(repo.verify(VERIFY)).resolves.toBe(false);
    });
  });
});
