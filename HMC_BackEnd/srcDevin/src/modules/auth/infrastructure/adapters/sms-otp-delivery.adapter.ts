import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { SmsConfig } from '@core/config/configuration';
import { OtpDeliveryPort } from '../../domain/ports/otp-delivery.port';
import { OtpPurpose } from '../../domain/ports/otp.port';

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
  private readonly logger = new Logger(SmsOtpDeliveryAdapter.name);
  private readonly cfg: SmsConfig;
  private readonly isProduction: boolean;

  constructor(
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<SmsConfig>('sms');
    this.isProduction = config.get<string>('app.nodeEnv') === 'production';
  }

  async sendOtpSms(phoneNumber: string, otp: string, purpose: OtpPurpose): Promise<void> {
    const masked = SmsOtpDeliveryAdapter.maskPhone(phoneNumber);
    if (!this.cfg.baseUrl) {
      if (this.isProduction) {
        this.logger.error('SMS_API_BASE_URL is not configured — cannot deliver OTP.');
        throw new ServiceUnavailableException('The SMS service is currently unavailable.');
      }
      this.logger.warn(`SMS gateway not configured — OTP (${purpose}) NOT sent to ${masked}.`);
      return;
    }

    const message = this.cfg.messageTemplate.replace(/\\n/g, '\n').replace(/\{otp\}/g, otp);
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
      this.logger.log(`OTP SMS (${purpose}) sent to ${masked}.`);
    } catch (err) {
      // Never include the request payload (raw OTP / full phone) in the error.
      this.logger.error(
        `OTP SMS (${purpose}) delivery to ${masked} failed: ${(err as Error).message}`,
      );
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
