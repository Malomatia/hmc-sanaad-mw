import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailConfig } from '@core/config/configuration';
import { EmailService, maskEmail } from '@core/email/email.service';
import { OtpEmailDeliveryPort } from '../../domain/ports/otp-email-delivery.port';
import { OtpPurpose } from '../../domain/ports/otp.port';

/**
 * Email OTP delivery (OtpEmailDeliveryPort) — the fallback channel used by
 * both OTP stores when the directory has no mobile number but does have a
 * corporate email. Formats the message from EMAIL_OTP_SUBJECT /
 * EMAIL_MESSAGE_TEMPLATE (`{otp}` substituted at send time) and hands it to
 * the core EmailService (SMTP), which owns the unconfigured-relay behaviour:
 * masked log-only in non-production, hard 503 in production.
 *
 * Security invariants match the SMS adapter: the raw OTP and the full email
 * address are never logged (EmailService masks the recipient).
 */
@Injectable()
export class EmailOtpDeliveryAdapter implements OtpEmailDeliveryPort {
  private readonly logger = new Logger(EmailOtpDeliveryAdapter.name);
  private readonly cfg: EmailConfig;

  constructor(
    private readonly email: EmailService,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<EmailConfig>('email');
  }

  async sendOtpEmail(email: string, otp: string, purpose: OtpPurpose): Promise<void> {
    const sent = await this.email.send({
      to: email,
      subject: this.cfg.otpSubject,
      text: this.cfg.messageTemplate.replace('{otp}', otp),
    });
    if (sent) {
      this.logger.log(`OTP email (${purpose}) sent to ${maskEmail(email)}.`);
    }
  }
}
