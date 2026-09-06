import { ConfigService } from '@nestjs/config';
import { EmailConfig } from '@core/config/configuration';
import { EmailService } from '@core/email/email.service';
import { EmailOtpDeliveryAdapter } from './email-otp-delivery.adapter';

const CONFIG: Partial<EmailConfig> = {
  otpSubject: 'Sanaad verification code',
  messageTemplate: 'Your Sanaad verification code is {otp}',
};

function makeAdapter(sent = true) {
  const email = {
    send: jest.fn().mockResolvedValue(sent),
  } as unknown as jest.Mocked<EmailService>;
  const configService = {
    getOrThrow: jest.fn().mockReturnValue(CONFIG),
  } as unknown as ConfigService;
  const adapter = new EmailOtpDeliveryAdapter(email, configService);
  return { adapter, email };
}

describe('EmailOtpDeliveryAdapter', () => {
  it('sends the templated OTP email through the core EmailService', async () => {
    const { adapter, email } = makeAdapter();

    await adapter.sendOtpEmail('hmc1@hamad.qa', '123456', 'ONBOARDING');

    expect(email.send).toHaveBeenCalledWith({
      to: 'hmc1@hamad.qa',
      subject: 'Sanaad verification code',
      text: 'Your Sanaad verification code is 123456',
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
