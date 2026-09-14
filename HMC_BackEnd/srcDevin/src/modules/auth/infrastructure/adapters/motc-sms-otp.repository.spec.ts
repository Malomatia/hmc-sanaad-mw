import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MotcSmsDbService } from '@core/database/motc-sms-db.service';
import { MssqlQueryError } from '@core/database/mssql.error';
import { MotcSmsConfig, OtpConfig, SmsConfig } from '@core/config/configuration';
import { MotcSmsOtpRepository } from './motc-sms-otp.repository';
import { OtpEmailDeliveryPort } from '../../domain/ports/otp-email-delivery.port';

const OTP_CFG: OtpConfig = {
  length: 6,
  ttlSeconds: 300,
  maxAttempts: 3,
  resendWindowSeconds: 60,
  staticValue: '',
  inResponse: false,
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

const TEMPLATE =
  'OTP to register for Sanaad App is {otp}\n\nرمز التحقق للتسجيل في تطبيق سند هو {otp}';
const SINGLE_TEMPLATE = 'Your Sanaad verification code is {otp}';

function makeRepo(
  otpCfg: Partial<OtpConfig> = {},
  motcCfg: Partial<MotcSmsConfig> = {},
  smsCfg: Partial<SmsConfig> = {},
) {
  const db = { query: jest.fn(), execute: jest.fn() } as unknown as jest.Mocked<MotcSmsDbService>;
  const emailDelivery: jest.Mocked<OtpEmailDeliveryPort> = {
    sendOtpEmail: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'otp') return { ...OTP_CFG, ...otpCfg };
      if (key === 'motcSms') return { ...MOTC_CFG, ...motcCfg };
      if (key === 'sms') {
        return { messageTemplate: TEMPLATE, ...smsCfg };
      }
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

  describe.each([
    { charset: 'numeric' as const, staticValue: '012345' },
    { charset: 'alphanumeric' as const, staticValue: 'A2B3C4' },
  ])('bilingual messages with $charset OTPs', (otpCfg) => {
    describe.each([
      { newlines: 'actual', messageTemplate: TEMPLATE },
      { newlines: 'escaped', messageTemplate: TEMPLATE.replace(/\n/g, '\\n') },
      { newlines: 'mixed', messageTemplate: TEMPLATE.replace('\n', '\\n') },
    ])('$newlines newlines', ({ messageTemplate }) => {
      it.each(['en', 'ar', undefined] as const)(
        'sends the same bilingual template for lang=%s and verifies without a language',
        async (lang) => {
          const { repo, db } = makeRepo(otpCfg, {}, { messageTemplate });
          primeSend(db);

          const result = await repo.send({ ...SEND, lang });

          const [, params] = db.execute.mock.calls[0] as [string, Record<string, unknown>];
          expect(params.messageBody).toBe(TEMPLATE.replace(/\{otp\}/g, otpCfg.staticValue));
          expect(params.messageBody).not.toContain('{otp}');
          expect(params.messageBody).not.toContain('\\n');
          db.query.mockResolvedValue([
            { MessageID: 42, DiffInSeconds: 10, MessageBody: params.messageBody },
          ]);
          const verify = {
            username: SEND.username,
            imei: SEND.imei,
            requestId: result.requestId,
            otp: otpCfg.staticValue,
          };
          await expect(repo.verify(verify)).resolves.toBe(true);
          await expect(repo.verify(verify)).resolves.toBe(false);
        },
      );
    });

    it('matches custom bilingual regex punctuation literally', async () => {
      const messageTemplate = 'Sanaad [{otp}].\n\nسند [تسجيل](رمز)+?.^$|\\ {otp} {صالح}*';
      const { repo, db } = makeRepo(otpCfg, {}, { messageTemplate });
      primeSend(db);

      const result = await repo.send({ ...SEND, lang: 'ar' });

      const [, params] = db.execute.mock.calls[0] as [string, Record<string, unknown>];
      const body = messageTemplate.replace(/\{otp\}/g, otpCfg.staticValue);
      expect(params.messageBody).toBe(body);
      const verify = {
        username: SEND.username,
        imei: SEND.imei,
        requestId: result.requestId,
        otp: otpCfg.staticValue,
      };
      db.query.mockResolvedValue([
        { MessageID: 42, DiffInSeconds: 10, MessageBody: body.replace('[تسجيل]', 'تسجيل') },
      ]);
      await expect(repo.verify(verify)).resolves.toBe(false);
      db.query.mockResolvedValue([{ MessageID: 42, DiffInSeconds: 10, MessageBody: body }]);
      await expect(repo.verify(verify)).resolves.toBe(true);
    });

    it.each([
      'Sanaad {otp}1\n\nسند {otp}2 / {otp}3',
      'Sanaad {otp}{otp}\n\nسند {otp}',
      SINGLE_TEMPLATE,
    ])('sends and verifies custom template "%s"', async (messageTemplate) => {
      const { repo, db } = makeRepo(otpCfg, {}, { messageTemplate });
      primeSend(db);

      const result = await repo.send(SEND);

      const [, params] = db.execute.mock.calls[0] as [string, Record<string, unknown>];
      expect(params.messageBody).toBe(messageTemplate.replace(/\{otp\}/g, otpCfg.staticValue));
      db.query.mockResolvedValue([
        { MessageID: 42, DiffInSeconds: 10, MessageBody: params.messageBody },
      ]);
      await expect(
        repo.verify({
          username: SEND.username,
          imei: SEND.imei,
          requestId: result.requestId,
          otp: otpCfg.staticValue,
        }),
      ).resolves.toBe(true);
    });

    it('rejects differing repeated codes and counts failed attempts', async () => {
      const { repo, db } = makeRepo(otpCfg);
      primeSend(db);
      const result = await repo.send(SEND);
      const [, params] = db.execute.mock.calls[0] as [string, Record<string, unknown>];
      const otherOtp = otpCfg.charset === 'numeric' ? '987654' : 'Z9Y8X7';
      const mismatch = String(params.messageBody).replace(otpCfg.staticValue, otherOtp);
      db.query.mockResolvedValue([{ MessageID: 42, DiffInSeconds: 10, MessageBody: mismatch }]);
      const verify = {
        username: SEND.username,
        imei: SEND.imei,
        requestId: result.requestId,
        otp: otpCfg.staticValue,
      };

      await expect(repo.verify({ ...verify, otp: otherOtp })).resolves.toBe(false);
      await expect(repo.verify(verify)).resolves.toBe(false);
      await expect(repo.verify(verify)).resolves.toBe(false);
      db.query.mockResolvedValue([
        { MessageID: 42, DiffInSeconds: 10, MessageBody: params.messageBody },
      ]);
      await expect(repo.verify(verify)).resolves.toBe(false);
    });

    it.each(['en', 'ar', undefined] as const)(
      'generates the configured charset for lang=%s',
      async (lang) => {
        const { repo, db } = makeRepo({ charset: otpCfg.charset });
        primeSend(db);

        const result = await repo.send({ ...SEND, lang });

        const [, params] = db.execute.mock.calls[0] as [string, Record<string, unknown>];
        const otp = String(params.messageBody).split(' ').pop()!;
        expect(otp).toMatch(otpCfg.charset === 'numeric' ? /^\d{6}$/ : /^[A-HJ-NP-Z2-9]{6}$/);
        expect(params.messageBody).toBe(TEMPLATE.replace(/\{otp\}/g, otp));
        db.query.mockResolvedValue([
          { MessageID: 42, DiffInSeconds: 10, MessageBody: params.messageBody },
        ]);
        await expect(
          repo.verify({
            username: SEND.username,
            imei: SEND.imei,
            requestId: result.requestId,
            otp,
          }),
        ).resolves.toBe(true);
      },
    );
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
      expect(params.messageBody).toMatch(
        /^OTP to register for Sanaad App is (\d{6})\n\nرمز التحقق للتسجيل في تطبيق سند هو \1$/,
      );
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
        expect(otp).toBeDefined();
        expect(params.messageBody).toBe(TEMPLATE.replace(/\{otp\}/g, otp!));
        expect(emailDelivery.sendOtpEmail).toHaveBeenCalledWith(
          'hmc1@hamad.qa',
          otp,
          'ONBOARDING',
          lang ?? 'en',
        );
        db.query.mockResolvedValue([
          { MessageID: 42, DiffInSeconds: 10, MessageBody: params.messageBody },
        ]);
        await expect(
          repo.verify({
            username: SEND.username,
            imei: SEND.imei,
            requestId: result.requestId,
            otp: otp!,
          }),
        ).resolves.toBe(true);
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

  describe.each(['SMS', 'Email'] as const)('OTP response exposure via %s', (mode) => {
    const command = {
      ...SEND,
      phoneNumber: mode === 'SMS' ? SEND.phoneNumber : undefined,
      email: mode === 'Email' ? 'hmc1@hamad.qa' : undefined,
    };

    it.each([
      { charset: 'numeric' as const, staticValue: '012345' },
      { charset: 'alphanumeric' as const, staticValue: 'A2B3C4' },
      { charset: 'numeric' as const, staticValue: '' },
      { charset: 'alphanumeric' as const, staticValue: '' },
    ])('returns the exact stored and delivered $charset OTP when enabled', async (otpCfg) => {
      const { repo, db, emailDelivery } = makeRepo({ ...otpCfg, inResponse: true });
      primeSend(db);

      const result = await repo.send(command);

      const [, params] = db.execute.mock.calls[0] as [string, Record<string, unknown>];
      const otp = String(params.messageBody).split(' ').pop()!;
      expect(otp).toMatch(otpCfg.charset === 'numeric' ? /^\d{6}$/ : /^[A-HJ-NP-Z2-9]{6}$/);
      if (otpCfg.staticValue) expect(otp).toBe(otpCfg.staticValue);
      expect(result).toEqual({
        requestId: '42',
        status: 'NEW',
        mode: 'SMS',
        validForSeconds: 300,
        otp,
      });
      expect(params.messageBody).toBe(TEMPLATE.replace(/\{otp\}/g, otp));
      if (mode === 'Email') {
        expect(params.processedState).toBe('1');
        expect(emailDelivery.sendOtpEmail).toHaveBeenCalledWith(
          command.email,
          otp,
          'ONBOARDING',
          'en',
        );
      } else {
        expect(params.processedState).toBe('0');
        expect(emailDelivery.sendOtpEmail).not.toHaveBeenCalled();
      }
    });

    it.each([
      { inResponse: false, purpose: 'ONBOARDING' as const },
      { inResponse: undefined, purpose: 'ONBOARDING' as const },
      { inResponse: true, purpose: 'FORGOT_MPIN' as const },
    ])('omits OTP: $inResponse / $purpose', async ({ inResponse, purpose }) => {
      const { repo, db } = makeRepo({ inResponse, staticValue: '012345' });
      primeSend(db);

      const result = await repo.send({ ...command, purpose });

      expect(result.status).toBe('NEW');
      expect(result).not.toHaveProperty('otp');
    });

    it('rejects rather than returning or emailing an OTP when storage fails', async () => {
      const { repo, db, emailDelivery } = makeRepo({ inResponse: true });
      primeSend(db);
      const failure = new MssqlQueryError('Invalid column name', { number: 207 });
      db.execute.mockRejectedValue(failure);

      await expect(repo.send(command)).rejects.toBe(failure);
      expect(emailDelivery.sendOtpEmail).not.toHaveBeenCalled();
    });
  });

  it('rejects when email delivery fails with OTP exposure enabled', async () => {
    const { repo, db, emailDelivery } = makeRepo({ inResponse: true });
    primeSend(db);
    const failure = new Error('Delivery failed');
    emailDelivery.sendOtpEmail.mockRejectedValue(failure);

    await expect(
      repo.send({ ...SEND, phoneNumber: undefined, email: 'hmc1@hamad.qa' }),
    ).rejects.toBe(failure);
  });

  describe('verify stored bilingual template', () => {
    const row = (overrides = {}) => [
      {
        MessageID: 42,
        DiffInSeconds: 10,
        MessageBody: TEMPLATE.replace(/\{otp\}/g, '123456'),
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

    it.each([
      { charset: 'numeric' as const, otp: 'A23456' },
      { charset: 'alphanumeric' as const, otp: 'AB-234' },
    ])('rejects stored codes outside the $charset policy', async ({ charset, otp }) => {
      const { repo, db } = makeRepo({ charset });
      db.query.mockResolvedValue(row({ MessageBody: TEMPLATE.replace(/\{otp\}/g, otp) }));

      await expect(repo.verify({ ...VERIFY, otp })).resolves.toBe(false);
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
