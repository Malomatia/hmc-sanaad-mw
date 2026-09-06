import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MotcSmsDbService } from '@core/database/motc-sms-db.service';
import { MssqlQueryError } from '@core/database/mssql.error';
import { MotcSmsConfig, OtpConfig } from '@core/config/configuration';
import { MotcSmsOtpRepository } from './motc-sms-otp.repository';
import { OtpEmailDeliveryPort } from '../../domain/ports/otp-email-delivery.port';

const OTP_CFG: OtpConfig = {
  length: 6,
  ttlSeconds: 300,
  maxAttempts: 3,
  resendWindowSeconds: 60,
  staticValue: '',
  charset: 'numeric',
  delivery: 'motc',
  store: 'motc',
};

const MOTC_CFG: Partial<MotcSmsConfig> = {
  table: 'MOTC_SMS_PushTable',
  appId: '77',
  fromAddress: '',
  subjectId: 'Sanaad OTP',
  priority: '1',
  languageId: '1',
  recipientAddressType: '1',
  processedState: '0',
  messageExpireMinutes: '5',
  customerId: '',
  maskMessageLog: '1',
  businessParam1: '',
  businessParam2: '',
  emailProcessedState: '1',
};

const TEMPLATE = 'Your Sanaad verification code is {otp}';

function makeRepo(otpCfg: Partial<OtpConfig> = {}, motcCfg: Partial<MotcSmsConfig> = {}) {
  const db = { query: jest.fn(), execute: jest.fn() } as unknown as jest.Mocked<MotcSmsDbService>;
  const emailDelivery: jest.Mocked<OtpEmailDeliveryPort> = {
    sendOtpEmail: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'otp') return { ...OTP_CFG, ...otpCfg };
      if (key === 'motcSms') return { ...MOTC_CFG, ...motcCfg };
      if (key === 'sms') return { messageTemplate: TEMPLATE };
      throw new Error(`unexpected config key ${key}`);
    }),
  } as unknown as ConfigService;
  const repo = new MotcSmsOtpRepository(db, emailDelivery, config);
  return { repo, db, emailDelivery };
}

const SEND = {
  username: 'hmc1',
  phoneNumber: '77861234',
  imei: 'imei-1',
  purpose: 'ONBOARDING' as const,
};

/** db.query responses: first the latest-row lookup, then the MAX+1 id. */
function primeSend(db: jest.Mocked<MotcSmsDbService>, nextId = 42) {
  db.query
    .mockResolvedValueOnce([]) // no previous OTP row
    .mockResolvedValueOnce([{ NextId: nextId }]);
  db.execute.mockResolvedValue({ rowsAffected: 1, rows: [] });
}

describe('MotcSmsOtpRepository', () => {
  it('rejects a non-identifier table name at construction', () => {
    expect(() => makeRepo({}, { table: 'PushTable; DROP TABLE x' })).toThrow(/MOTC_SMS_TABLE/);
  });

  describe('send', () => {
    it('inserts the documented push row and returns the MessageID as requestid', async () => {
      const { repo, db } = makeRepo();
      primeSend(db, 42);

      const result = await repo.send(SEND);

      expect(result.requestId).toBe('42');
      const [statement, params] = db.execute.mock.calls[0] as [string, Record<string, unknown>];
      expect(statement).toContain('INSERT INTO MOTC_SMS_PushTable');
      expect(params).toMatchObject({
        messageId: 42,
        toAddress: '77861234',
        processedState: '0',
        priority: '1',
        serviceId: '77',
        subjectId: 'Sanaad OTP',
        languageId: '1',
        recipientAddressType: '1',
        messageExpireMinutes: '5',
        customerId: null,
        fromAddress: '77', // defaults to the AppId, as in the client's INSERT
        maskMessageLog: '1',
        applicationId: '77',
        businessParam1: 'hmc1', // username correlation
        businessParam2: 'imei-1', // device correlation
      });
      expect(params.messageBody).toMatch(/^Your Sanaad verification code is \d{6}$/);
    });

    it('rejects a resend inside the resend window with 429', async () => {
      const { repo, db } = makeRepo();
      db.query.mockResolvedValue([{ MessageID: 41, DiffInSeconds: 30, MessageBody: 'x' }]);

      await expect(repo.send(SEND)).rejects.toMatchObject({ status: 429 });
      expect(db.execute).not.toHaveBeenCalled();
    });

    it('allows a resend once the window elapsed', async () => {
      const { repo, db } = makeRepo();
      db.query
        .mockResolvedValueOnce([{ MessageID: 41, DiffInSeconds: 61, MessageBody: 'x' }])
        .mockResolvedValueOnce([{ NextId: 42 }]);
      db.execute.mockResolvedValue({ rowsAffected: 1, rows: [] });

      await expect(repo.send(SEND)).resolves.toEqual({
        requestId: '42',
        status: 'NEW',
        mode: 'SMS',
        validForSeconds: 300,
      });
    });

    it('rejects when the user has neither a phone number nor an email', async () => {
      const { repo, db } = makeRepo();
      db.query.mockResolvedValue([]);

      await expect(repo.send({ ...SEND, phoneNumber: undefined })).rejects.toBeInstanceOf(
        HttpException,
      );
      expect(db.execute).not.toHaveBeenCalled();
    });

    it('does not use the email channel when the user has a phone number', async () => {
      const { repo, db, emailDelivery } = makeRepo();
      primeSend(db, 42);

      await repo.send({ ...SEND, email: 'hmc1@hamad.qa' });

      expect(emailDelivery.sendOtpEmail).not.toHaveBeenCalled();
    });

    it.each(['en', 'ar', undefined] as const)(
      'falls back to email with lang=%s: stores a non-pushable row and delivers over SMTP',
      async (lang) => {
        const { repo, db, emailDelivery } = makeRepo();
        primeSend(db, 42);

        const result = await repo.send({
          ...SEND,
          phoneNumber: undefined,
          email: 'hmc1@hamad.qa',
          lang,
        });

        expect(result.requestId).toBe('42');
        const [, params] = db.execute.mock.calls[0] as [string, Record<string, unknown>];
        expect(params).toMatchObject({
          toAddress: 'hmc1@hamad.qa',
          processedState: '1', // emailProcessedState — the SMS gateway must not push it
        });
        const otp = /(\d{6})$/.exec(String(params.messageBody))?.[1];
        expect(emailDelivery.sendOtpEmail).toHaveBeenCalledWith(
          'hmc1@hamad.qa',
          otp,
          'ONBOARDING',
          lang ?? 'en',
        );
      },
    );

    it('retries with a fresh MessageID when the MAX+1 insert races a duplicate', async () => {
      const { repo, db } = makeRepo();
      db.query
        .mockResolvedValueOnce([]) // latest-row lookup
        .mockResolvedValueOnce([{ NextId: 42 }])
        .mockResolvedValueOnce([{ NextId: 43 }]);
      const duplicate = new MssqlQueryError('Violation of PRIMARY KEY', { number: 2627 });
      db.execute
        .mockRejectedValueOnce(duplicate)
        .mockResolvedValueOnce({ rowsAffected: 1, rows: [] });

      await expect(repo.send(SEND)).resolves.toEqual({
        requestId: '43',
        status: 'NEW',
        mode: 'SMS',
        validForSeconds: 300,
      });
      expect(db.execute).toHaveBeenCalledTimes(2);
    });

    it('propagates non-duplicate insert failures', async () => {
      const { repo, db } = makeRepo();
      primeSend(db);
      db.execute.mockRejectedValue(new MssqlQueryError('Invalid column name', { number: 207 }));

      await expect(repo.send(SEND)).rejects.toBeInstanceOf(MssqlQueryError);
    });
  });

  describe('verify', () => {
    const row = (overrides = {}) => [
      {
        MessageID: 42,
        DiffInSeconds: 10,
        MessageBody: 'Your Sanaad verification code is 123456',
        ...overrides,
      },
    ];
    const VERIFY = { username: 'hmc1', imei: 'imei-1', requestId: '42', otp: '123456' };

    it('accepts the right OTP extracted from the stored MessageBody', async () => {
      const { repo, db } = makeRepo();
      db.query.mockResolvedValue(row());

      await expect(repo.verify(VERIFY)).resolves.toBe(true);
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('BusinessParam1 = @username'), {
        username: 'hmc1',
        imei: 'imei-1',
      });
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

    it('rejects when no push row exists', async () => {
      const { repo, db } = makeRepo();
      db.query.mockResolvedValue([]);

      await expect(repo.verify(VERIFY)).resolves.toBe(false);
    });

    it('rejects a MessageBody that does not match the template', async () => {
      const { repo, db } = makeRepo();
      db.query.mockResolvedValue(row({ MessageBody: 'Some unrelated SMS text' }));

      await expect(repo.verify(VERIFY)).resolves.toBe(false);
    });

    it('falls back to a MessageID lookup when BusinessParams are pinned', async () => {
      const { repo, db } = makeRepo({}, { businessParam1: 'SANAAD', businessParam2: 'OTP' });
      db.query.mockResolvedValue(row());

      await expect(repo.verify(VERIFY)).resolves.toBe(true);
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('MessageID = @messageId'), {
        messageId: 42,
      });
    });
  });
});
