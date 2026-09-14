import { ConfigService } from '@nestjs/config';
import configuration from '@core/config/configuration';
import { envValidationSchema } from '@core/config/env.validation';
import { EmailService } from '@core/email/email.service';
import { EmailOtpDeliveryAdapter } from './email-otp-delivery.adapter';

function makeAdapter(sent = true) {
  const email = {
    send: jest.fn().mockResolvedValue(sent),
  } as unknown as jest.Mocked<EmailService>;
  const configService = {
    getOrThrow: jest.fn().mockReturnValue(configuration().email),
  } as unknown as ConfigService;
  const adapter = new EmailOtpDeliveryAdapter(email, configService);
  return { adapter, email };
}

describe('EmailOtpDeliveryAdapter', () => {
  const keys = ['EMAIL_OTP_SUBJECT', 'EMAIL_MESSAGE_TEMPLATE', 'EMAIL_MESSAGE_TEMPLATE_AR'];
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

  describe.each(['ONBOARDING', 'FORGOT_MPIN'] as const)('%s', (purpose) => {
    it.each([
      ['en', 'OTP to register in Sanaad App is 937591'],
      ['ar', 'رمز التحقق لتسجيل الدخول في تطبيق سند هو 937591'],
      [undefined, 'OTP to register in Sanaad App is 937591'],
    ] as const)('sends the OTP email with lang=%s', async (lang, text) => {
      const { adapter, email } = makeAdapter();

      await adapter.sendOtpEmail('hmc1@hamad.qa', '937591', purpose, lang);

      expect(email.send).toHaveBeenCalledWith({
        to: 'hmc1@hamad.qa',
        subject: 'Sanaad verification code',
        text,
      });
    });
  });

  it('keeps environment-validation defaults aligned with the email templates', () => {
    const cfg = configuration().email;

    expect(envValidationSchema.extract('EMAIL_MESSAGE_TEMPLATE').validate(undefined).value).toBe(
      cfg.messageTemplate,
    );
    expect(envValidationSchema.extract('EMAIL_MESSAGE_TEMPLATE_AR').validate(undefined).value).toBe(
      cfg.messageTemplateAr,
    );
  });

  it('substitutes the actual OTP without losing leading zeroes', async () => {
    const { adapter, email } = makeAdapter();

    await adapter.sendOtpEmail('hmc1@hamad.qa', '012345', 'ONBOARDING', 'ar');

    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'رمز التحقق لتسجيل الدخول في تطبيق سند هو 012345' }),
    );
  });

  it('honors separate English and Arabic template overrides', async () => {
    process.env.EMAIL_OTP_SUBJECT = 'Verification';
    process.env.EMAIL_MESSAGE_TEMPLATE = 'Code: {otp}';
    process.env.EMAIL_MESSAGE_TEMPLATE_AR = 'رمز التحقق: {otp}';
    const { adapter, email } = makeAdapter();

    await adapter.sendOtpEmail('hmc1@hamad.qa', '123456', 'ONBOARDING', 'en');
    await adapter.sendOtpEmail('hmc1@hamad.qa', '654321', 'ONBOARDING', 'ar');

    expect(email.send).toHaveBeenNthCalledWith(1, {
      to: 'hmc1@hamad.qa',
      subject: 'Verification',
      text: 'Code: 123456',
    });
    expect(email.send).toHaveBeenNthCalledWith(2, {
      to: 'hmc1@hamad.qa',
      subject: 'Verification',
      text: 'رمز التحقق: 654321',
    });
  });

  it('propagates EmailService failures (unavailable relay)', async () => {
    const { adapter, email } = makeAdapter();
    email.send.mockRejectedValue(new Error('SMTP down'));

    await expect(adapter.sendOtpEmail('hmc1@hamad.qa', '123456', 'FORGOT_MPIN')).rejects.toThrow(
      'SMTP down',
    );
  });

  it('resolves quietly when the relay is unconfigured (log-only mode)', async () => {
    const { adapter } = makeAdapter(false);

    await expect(
      adapter.sendOtpEmail('hmc1@hamad.qa', '123456', 'ONBOARDING'),
    ).resolves.toBeUndefined();
  });
});
