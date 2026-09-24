import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { SmsConfig } from '@core/config/configuration';
import { OtpDeliveryPort } from '../../domain/ports/otp-delivery.port';
import { OtpPurpose, OtpSmsTemplate } from '../../domain/ports/otp.port';
import { Lang } from '@shared/domain/lang';

/**
 * Generic, config-driven SMS gateway adapter for OTP delivery (OtpDeliveryPort).
 * The corporate gateway contract is not final yet, so this posts a plain JSON
 * body — `{ to, message, senderId }` with a Bearer key — that can be re-pointed
 * via SMS_* env vars once the real contract arrives.
 *
 * Security invariants: the raw OTP and the full phone number are never logged
 * (phone is masked to its last 3 digits). With no SMS_API_BASE_URL configured,
 * non-production logs a masked delivery instead of calling out; production
 * fails hard — onboarding must not silently proceed without a real SMS.
 */
@Injectable()
export class SmsOtpDeliveryAdapter implements OtpDeliveryPort {
  private readonly cfg: SmsConfig;
  private readonly isProduction: boolean;

  constructor(
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<SmsConfig>('sms');
    this.isProduction = config.get<string>('app.nodeEnv') === 'production';
  }

  async sendOtpSms(
    phoneNumber: string,
    otp: string,
    purpose: OtpPurpose,
    _lang?: Lang,
    smsTemplate?: OtpSmsTemplate,
  ): Promise<void> {
    if (!this.cfg.baseUrl) {
      if (this.isProduction) {
        throw new ServiceUnavailableException('The SMS service is currently unavailable.');
      }

      return;
    }

    const template =
      smsTemplate === 'forget'
        ? this.cfg.forgetMessageTemplate || this.cfg.messageTemplate
        : this.cfg.messageTemplate;
    const message = template.replace(/\\n/g, '\n').replace(/\{otp\}/g, otp);
    try {
      await firstValueFrom(
        this.http.post(
          this.cfg.baseUrl,
          { to: phoneNumber, message, senderId: this.cfg.senderId },
          {
            timeout: this.cfg.timeoutMs,
            headers: this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {},
          },
        ),
      );
    } catch (err) {
      // Never include the request payload (raw OTP / full phone) in the error.

      throw new ServiceUnavailableException('The SMS service is currently unavailable.');
    }
  }

  /** Keep only the last 3 digits, e.g. `*****789`. */
  private static maskPhone(phone: string): string {
    if (!phone) return '(no phone)';
    const visible = phone.slice(-3);
    return `${'*'.repeat(Math.max(phone.length - 3, 1))}${visible}`;
  }
}
