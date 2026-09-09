import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MssqlService } from '@core/database/mssql.service';
import { OtpConfig } from '@core/config/configuration';
import { MssqlOtpRepository } from './mssql-otp.repository';
import { OtpDeliveryPort } from '../../domain/ports/otp-delivery.port';
import { OtpEmailDeliveryPort } from '../../domain/ports/otp-email-delivery.port';

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
  const emailDelivery: jest.Mocked<OtpEmailDeliveryPort> = {
    sendOtpEmail: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    getOrThrow: jest.fn().mockReturnValue({ ...OTP_CFG, ...cfg }),
  } as unknown as ConfigService;
  const repo = new MssqlOtpRepository(db, delivery, emailDelivery, config);
  return { repo, db, delivery, emailDelivery };
}

const SEND = {
  username: 'hmc1',
  phoneNumber: '77861234',
  imei: 'imei-1',
  purpose: 'ONBOARDING' as const,
};

describe('MssqlOtpRepository', () => {
  describe('send (upsert, 2026-09-05)', () => {
    it('INSERTs the first OTP row for a user+device and delivers it by SMS', async () => {
      const { repo, db, delivery } = makeRepo();
      db.query.mockResolvedValue([]); // no previous OTP
      db.execute
        .mockResolvedValueOnce({ rowsAffected: 0, rows: [] }) // UPDATE hits nothing
        .mockResolvedValueOnce({ rowsAffected: 1, rows: [{ SeqNo: 42 }] }); // INSERT

      const result = await repo.send(SEND);

      expect(result).toEqual({
        requestId: '42',
        status: 'NEW',
        mode: 'SMS',
        validForSeconds: 300,
      });
      expect(db.execute).toHaveBeenLastCalledWith(
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
          sendMode: 'SMS',
        }),
      );
      const otp = (db.execute.mock.calls[1][1] as { otp: string }).otp;
      expect(delivery.sendOtpSms).toHaveBeenCalledWith('77861234', otp, 'ONBOARDING', 'en');
    });

    describe.each(['ONBOARDING', 'FORGOT_MPIN'] as const)('%s SMS language', (purpose) => {
      it.each(['en', 'ar', undefined] as const)(
        'forwards lang=%s to SMS delivery',
        async (lang) => {
          const { repo, db, delivery } = makeRepo();
          db.query.mockResolvedValue([]);
          db.execute.mockResolvedValue({ rowsAffected: 1, rows: [{ SeqNo: 42 }] });

          await repo.send({ ...SEND, purpose, lang });

          const otp = (db.execute.mock.calls[0][1] as { otp: string }).otp;
          expect(delivery.sendOtpSms).toHaveBeenCalledWith('77861234', otp, purpose, lang ?? 'en');
        },
      );
    });

    it('UPDATEs the existing newest row when the previous OTP expired', async () => {
      const { repo, db } = makeRepo();
      db.query.mockResolvedValue([{ SeqNo: 41, DiffInSeconds: 301, OTPValue: '111111' }]);
      db.execute.mockResolvedValue({ rowsAffected: 1, rows: [{ SeqNo: 41 }] });

      const result = await repo.send(SEND);

      expect(result).toEqual({
        requestId: '41',
        status: 'NEW',
        mode: 'SMS',
        validForSeconds: 300,
      });
      expect(db.execute).toHaveBeenCalledTimes(1);
      expect(db.execute).toHaveBeenCalledWith(
        expect.stringMatching(/UPDATE HMC_RHAP_OTP_tbl[\s\S]*OTPStatus = '1'[\s\S]*SELECT MAX\(SeqNo\)/),
        expect.objectContaining({ username: 'hmc1', imei: 'imei-1' }),
      );
    });

    it('keeps a still-valid unused OTP and answers PENDING without writing or sending', async () => {
      const { repo, db, delivery } = makeRepo();
      db.query.mockResolvedValue([
        { SeqNo: 41, DiffInSeconds: 30, OTPValue: '111111', OTPStatus: '1', OTPSendMode: 'SMS' },
      ]);

      await expect(repo.send(SEND)).resolves.toEqual({
        requestId: '41',
        status: 'PENDING',
        mode: 'SMS',
        validForSeconds: 270, // ttl 300 - 30 elapsed
      });
      expect(db.execute).not.toHaveBeenCalled();
      expect(delivery.sendOtpSms).not.toHaveBeenCalled();
    });

    it('replaces a used OTP (OTPStatus=0) even inside the TTL', async () => {
      const { repo, db } = makeRepo();
      db.query.mockResolvedValue([
        { SeqNo: 41, DiffInSeconds: 30, OTPValue: '111111', OTPStatus: '0' },
      ]);
      db.execute.mockResolvedValue({ rowsAffected: 1, rows: [{ SeqNo: 41 }] });

      await expect(repo.send(SEND)).resolves.toMatchObject({ status: 'NEW' });
    });

    it('records the Email channel when the user has no phone (no SMS is sent)', async () => {
      const { repo, db, delivery } = makeRepo();
      db.query.mockResolvedValue([]);
      db.execute
        .mockResolvedValueOnce({ rowsAffected: 0, rows: [] })
        .mockResolvedValueOnce({ rowsAffected: 1, rows: [{ SeqNo: 50 }] });

      const result = await repo.send({ ...SEND, phoneNumber: undefined, email: 'u@hamad.qa' });

      expect(result).toEqual({
        requestId: '50',
        status: 'NEW',
        mode: 'Email',
        validForSeconds: 300,
      });
      expect(db.execute).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ sendMode: 'Email' }),
      );
      expect(delivery.sendOtpSms).not.toHaveBeenCalled();
    });

    it('rejects when the user has neither a phone number nor an email', async () => {
      const { repo, db } = makeRepo();
      db.query.mockResolvedValue([]);

      await expect(
        repo.send({ ...SEND, phoneNumber: undefined, email: undefined }),
      ).rejects.toBeInstanceOf(HttpException);
      expect(db.execute).not.toHaveBeenCalled();
    });

    it('prefers SMS when the user has both a phone number and an email', async () => {
      const { repo, db, delivery, emailDelivery } = makeRepo();
      db.query.mockResolvedValue([]);
      db.execute.mockResolvedValue({ rowsAffected: 1, rows: [{ SeqNo: 42 }] });

      await repo.send({ ...SEND, email: 'hmc1@hamad.qa' });

      expect(delivery.sendOtpSms).toHaveBeenCalled();
      expect(emailDelivery.sendOtpEmail).not.toHaveBeenCalled();
    });

    it.each(['en', 'ar', undefined] as const)(
      'falls back to email delivery with lang=%s when the user has no phone number',
      async (lang) => {
        const { repo, db, delivery, emailDelivery } = makeRepo();
        db.query.mockResolvedValue([]);
        db.execute.mockResolvedValue({ rowsAffected: 1, rows: [{ SeqNo: 42 }] });

        const result = await repo.send({
          ...SEND,
          phoneNumber: undefined,
          email: 'hmc1@hamad.qa',
          lang,
        });

        expect(result.requestId).toBe('42');
        const otp = (db.execute.mock.calls[0][1] as { otp: string }).otp;
        expect(emailDelivery.sendOtpEmail).toHaveBeenCalledWith(
          'hmc1@hamad.qa',
          otp,
          'ONBOARDING',
          lang ?? 'en',
        );
        expect(delivery.sendOtpSms).not.toHaveBeenCalled();
      },
    );
  });

  describe('verify', () => {
    const row = (overrides = {}) => [
      { SeqNo: 42, DiffInSeconds: 10, OTPValue: '123456', OTPStatus: '1', ...overrides },
    ];
    const VERIFY = { username: 'hmc1', imei: 'imei-1', requestId: '42', otp: '123456' };

    it('accepts the right OTP and durably marks the row used', async () => {
      const { repo, db } = makeRepo();
      db.query.mockResolvedValue(row());
      db.execute.mockResolvedValue({ rowsAffected: 1, rows: [] });

      await expect(repo.verify(VERIFY)).resolves.toBe(true);
      expect(db.execute).toHaveBeenCalledWith(
        expect.stringMatching(/OTPValidationAttemptCount[\s\S]*OTPStatus = '0'/),
        { seqNo: 42 },
      );
    });

    it('is single-use: a verified OTP cannot be replayed', async () => {
      const { repo, db } = makeRepo();
      db.query.mockResolvedValue(row());
      db.execute.mockResolvedValue({ rowsAffected: 1, rows: [] });

      await expect(repo.verify(VERIFY)).resolves.toBe(true);
      await expect(repo.verify(VERIFY)).resolves.toBe(false);
    });

    it('rejects a durably used OTP (OTPStatus=0) even with a cold cache', async () => {
      const { repo, db } = makeRepo();
      db.query.mockResolvedValue(row({ OTPStatus: '0' }));

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
      db.execute.mockResolvedValue({ rowsAffected: 1, rows: [] });

      for (let i = 0; i < 3; i++) {
        await expect(repo.verify({ ...VERIFY, otp: '000000' })).resolves.toBe(false);
      }
      // even the correct OTP is now refused
      await expect(repo.verify(VERIFY)).resolves.toBe(false);
    });

    it('compares numeric OTPValue columns as strings', async () => {
      const { repo, db } = makeRepo();
      db.query.mockResolvedValue(row({ OTPValue: 123456 }));
      db.execute.mockResolvedValue({ rowsAffected: 1, rows: [] });

      await expect(repo.verify(VERIFY)).resolves.toBe(true);
    });

    it('rejects when no OTP row exists', async () => {
      const { repo, db } = makeRepo();
      db.query.mockResolvedValue([]);

      await expect(repo.verify(VERIFY)).resolves.toBe(false);
    });
  });
});
