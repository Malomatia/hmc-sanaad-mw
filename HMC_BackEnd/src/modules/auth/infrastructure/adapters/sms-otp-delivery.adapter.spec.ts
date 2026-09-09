import { ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';
import configuration, { SmsConfig } from '@core/config/configuration';
import { envValidationSchema } from '@core/config/env.validation';
import { MotcSmsDbService } from '@core/database/motc-sms-db.service';
import { OtpDeliveryPort } from '../../domain/ports/otp-delivery.port';
import { SmsOtpDeliveryAdapter } from './sms-otp-delivery.adapter';
import { MotcPushOtpDeliveryAdapter } from './motc-push-otp-delivery.adapter';

const TEMPLATE =
  'OTP to register for Sanaad App is {otp}\n\nرمز التحقق للتسجيل في تطبيق سند هو {otp}';
const CONFIG: SmsConfig = {
  baseUrl: 'https://sms.hamad.qa/api/send',
  apiKey: 'sms-key',
  senderId: 'HMC',
  timeoutMs: 25000,
  messageTemplate: TEMPLATE,
};

const ok = (): AxiosResponse =>
  ({ data: {}, status: 200, statusText: 'OK', headers: {}, config: {} }) as AxiosResponse;

function makeAdapter(config: Partial<SmsConfig> = {}, nodeEnv = 'production') {
  const http = { post: jest.fn() } as unknown as jest.Mocked<HttpService>;
  const configService = {
    getOrThrow: jest.fn().mockReturnValue({ ...CONFIG, ...config }),
    get: jest.fn().mockReturnValue(nodeEnv),
  } as unknown as ConfigService;
  const adapter = new SmsOtpDeliveryAdapter(http, configService);
  return { adapter, http };
}

function makeMotcAdapter(sms: Partial<SmsConfig> = {}) {
  const db = {
    execute: jest.fn().mockResolvedValue({ rowsAffected: 1, rows: [] }),
  } as unknown as jest.Mocked<MotcSmsDbService>;
  const config = new ConfigService({
    sms: { ...CONFIG, ...sms },
    motcSms: { ...configuration().motcSms, table: 'MOTC_SMS_PushTable', languageId: '1' },
  });
  return { adapter: new MotcPushOtpDeliveryAdapter(db, config), db };
}

function makeDelivery(
  transport: 'http' | 'motc',
  config: Partial<SmsConfig> = {},
): { adapter: OtpDeliveryPort; message: () => string } {
  if (transport === 'http') {
    const { adapter, http } = makeAdapter(config);
    http.post.mockReturnValue(of(ok()));
    return { adapter, message: () => (http.post.mock.calls[0][1] as { message: string }).message };
  }
  const { adapter, db } = makeMotcAdapter(config);
  return {
    adapter,
    message: () => (db.execute.mock.calls[0][1] as { messageBody: string }).messageBody,
  };
}

describe('SmsOtpDeliveryAdapter', () => {
  it('posts the bilingual message with the bearer key', async () => {
    const { adapter, http } = makeAdapter();
    http.post.mockReturnValue(of(ok()));

    await adapter.sendOtpSms('77861234', '123456', 'ONBOARDING');

    expect(http.post).toHaveBeenCalledWith(
      CONFIG.baseUrl,
      {
        to: '77861234',
        message:
          'OTP to register for Sanaad App is 123456\n\nرمز التحقق للتسجيل في تطبيق سند هو 123456',
        senderId: 'HMC',
      },
      expect.objectContaining({
        timeout: 25000,
        headers: { Authorization: 'Bearer sms-key' },
      }),
    );
  });

  it('maps a gateway failure to ServiceUnavailableException', async () => {
    const { adapter, http } = makeAdapter();
    http.post.mockReturnValue(throwError(() => new Error('ECONNREFUSED')));

    await expect(adapter.sendOtpSms('77861234', '123456', 'ONBOARDING')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('fails hard in production when no gateway is configured', async () => {
    const { adapter, http } = makeAdapter({ baseUrl: '' }, 'production');

    await expect(adapter.sendOtpSms('77861234', '123456', 'ONBOARDING')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(http.post).not.toHaveBeenCalled();
  });

  it('is log-only in non-production when no gateway is configured', async () => {
    const { adapter, http } = makeAdapter({ baseUrl: '' }, 'development');

    await expect(adapter.sendOtpSms('77861234', '123456', 'ONBOARDING')).resolves.toBeUndefined();
    expect(http.post).not.toHaveBeenCalled();
  });
});

describe.each(['http', 'motc'] as const)('%s bilingual SMS delivery', (transport) => {
  describe.each(['ONBOARDING', 'FORGOT_MPIN'] as const)('%s', (purpose) => {
    it.each(['en', 'ar', undefined] as const)(
      'ignores lang=%s and preserves zeroes',
      async (lang) => {
        const { adapter, message } = makeDelivery(transport);

        await adapter.sendOtpSms('77861234', '012345', purpose, lang);

        expect(message()).toBe(
          'OTP to register for Sanaad App is 012345\n\nرمز التحقق للتسجيل في تطبيق سند هو 012345',
        );
      },
    );
  });

  it.each(['\n\n', '\\n\\n'])('supports environment newline format %j', async (separator) => {
    const { adapter, message } = makeDelivery(transport, {
      messageTemplate: `Code [{otp}].${separator}رمز التحقق [{otp}].`,
    });

    await adapter.sendOtpSms('77861234', 'AB2C34', 'ONBOARDING', 'ar');

    expect(message()).toBe('Code [AB2C34].\n\nرمز التحقق [AB2C34].');
    expect(message()).not.toContain('{otp}');
  });

  it('still supports a custom single-placeholder template', async () => {
    const { adapter, message } = makeDelivery(transport, { messageTemplate: 'Code: {otp}' });

    await adapter.sendOtpSms('77861234', '012345', 'ONBOARDING', 'ar');

    expect(message()).toBe('Code: 012345');
  });
});

describe('SMS template configuration', () => {
  const keys = ['SMS_MESSAGE_TEMPLATE', 'SMS_MESSAGE_TEMPLATE_AR'];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of keys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('keeps runtime and environment-validation bilingual defaults aligned', () => {
    const cfg = configuration().sms;
    expect(cfg.messageTemplate).toBe(TEMPLATE);
    expect(envValidationSchema.extract('SMS_MESSAGE_TEMPLATE').validate(undefined).value).toBe(
      cfg.messageTemplate,
    );
  });

  it.each(['http', 'motc'] as const)(
    'renders the server environment override through %s',
    async (transport) => {
      process.env.SMS_MESSAGE_TEMPLATE = 'Code: {otp}\\n\\nرمز التحقق: {otp}';
      process.env.SMS_MESSAGE_TEMPLATE_AR = 'Obsolete template: {otp}';
      const cfg = configuration().sms;
      const { adapter, message } = makeDelivery(transport, {
        messageTemplate: cfg.messageTemplate,
      });

      await adapter.sendOtpSms('77861234', '012345', 'ONBOARDING', 'ar');

      expect(message()).toBe('Code: 012345\n\nرمز التحقق: 012345');
    },
  );
});
