import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { EmailConfig } from '../config/configuration';
import { EmailService, maskEmail } from './email.service';

jest.mock('nodemailer');

const CONFIG: EmailConfig = {
  smtpHost: 'smtp.hamad.qa',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: 'sanaad',
  smtpPassword: 'secret',
  tlsRejectUnauthorized: true,
  from: 'Sanaad <no-reply@hamad.qa>',
  otpSubject: 'Sanaad verification code',
  messageTemplate: 'Your Sanaad verification code is {otp}',
  timeoutMs: 25000,
};

const MESSAGE = { to: 'hmc1@hamad.qa', subject: 'Test', text: 'Hello' };

function makeService(config: Partial<EmailConfig> = {}, nodeEnv = 'production') {
  const sendMail = jest.fn().mockResolvedValue({ messageId: '<id>' });
  (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail, close: jest.fn() });
  const configService = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'email') return { ...CONFIG, ...config };
      if (key === 'app') return { nodeEnv };
      throw new Error(`unexpected config key ${key}`);
    }),
  } as unknown as ConfigService;
  const service = new EmailService(configService);
  return { service, sendMail };
}

describe('EmailService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends through the configured SMTP transport', async () => {
    const { service, sendMail } = makeService();

    await expect(service.send(MESSAGE)).resolves.toBe(true);

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.hamad.qa',
        port: 587,
        secure: false,
        auth: { user: 'sanaad', pass: 'secret' },
        tls: { rejectUnauthorized: true },
      }),
    );
    expect(sendMail).toHaveBeenCalledWith({
      from: 'Sanaad <no-reply@hamad.qa>',
      to: 'hmc1@hamad.qa',
      subject: 'Test',
      text: 'Hello',
    });
  });

  it('reuses one transporter across sends', async () => {
    const { service } = makeService();

    await service.send(MESSAGE);
    await service.send(MESSAGE);

    expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
  });

  it('omits auth when no SMTP user is configured (anonymous relay)', async () => {
    const { service } = makeService({ smtpUser: '' });

    await service.send(MESSAGE);

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: undefined }),
    );
  });

  it('maps a relay failure to ServiceUnavailableException', async () => {
    const { service, sendMail } = makeService();
    sendMail.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.send(MESSAGE)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('fails hard in production when SMTP is not configured', async () => {
    const { service, sendMail } = makeService({ smtpHost: '' }, 'production');

    await expect(service.send(MESSAGE)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('is log-only in non-production when SMTP is not configured', async () => {
    const { service, sendMail } = makeService({ smtpHost: '' }, 'development');

    await expect(service.send(MESSAGE)).resolves.toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe('maskEmail', () => {
  it('keeps the first character and the domain', () => {
    expect(maskEmail('aibrahim39@hamad.qa')).toBe('a***@hamad.qa');
  });

  it('handles empty and malformed addresses', () => {
    expect(maskEmail('')).toBe('(no email)');
    expect(maskEmail('not-an-email')).toBe('***');
  });
});
