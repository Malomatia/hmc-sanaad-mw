import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { AppConfig, EmailConfig } from '../config/configuration';

export interface SendEmailCommand {
  to: string;
  subject: string;
  /** Plain-text body. May carry an OTP — never logged. */
  text: string;
}

/**
 * SMTP email sender (nodemailer) shared by the OTP email-delivery adapter and
 * the diagnostics test endpoint. Config-driven via the `email` namespace
 * (SMTP_HOST/PORT/SECURE/USER/PASSWORD, EMAIL_FROM, ...).
 *
 * Mirrors the SMS adapter's contract: with no SMTP_HOST configured,
 * non-production logs a masked delivery instead of calling out (send()
 * returns false); production fails hard — a flow that needs the email must
 * not silently proceed without it. The body and the full recipient address
 * are never logged (recipient is masked via maskEmail).
 *
 * The transporter is created lazily on first send and reused (nodemailer
 * pools connections per transporter); it is closed on module destroy.
 */
@Injectable()
export class EmailService implements OnModuleDestroy {
  private readonly logger = new Logger(EmailService.name);
  private readonly cfg: EmailConfig;
  private readonly isProduction: boolean;
  private transporter?: Transporter;

  constructor(config: ConfigService) {
    this.cfg = config.getOrThrow<EmailConfig>('email');
    this.isProduction = config.getOrThrow<AppConfig>('app').nodeEnv === 'production';
  }

  /** Whether an SMTP relay is configured (SMTP_HOST set). */
  get isConfigured(): boolean {
    return !!this.cfg.smtpHost;
  }

  /**
   * Sends a plain-text email. Returns true when the message actually left via
   * SMTP; false when SMTP is unconfigured in non-production (masked log-only).
   */
  async send(cmd: SendEmailCommand): Promise<boolean> {
    const masked = maskEmail(cmd.to);
    if (!this.isConfigured) {
      if (this.isProduction) {
        this.logger.error('SMTP_HOST is not configured — cannot send email.');
        throw new ServiceUnavailableException('The email service is currently unavailable.');
      }
      this.logger.warn(`SMTP not configured — email "${cmd.subject}" NOT sent to ${masked}.`);
      return false;
    }

    try {
      await this.getTransporter().sendMail({
        from: this.cfg.from,
        to: cmd.to,
        subject: cmd.subject,
        text: cmd.text,
      });
      this.logger.log(`Email "${cmd.subject}" sent to ${masked}.`);
      return true;
    } catch (err) {
      // Never include the message body (may carry an OTP) in the error.
      this.logger.error(`Email "${cmd.subject}" to ${masked} failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('The email service is currently unavailable.');
    }
  }

  private getTransporter(): Transporter {
    this.transporter ??= nodemailer.createTransport({
      host: this.cfg.smtpHost,
      port: this.cfg.smtpPort,
      secure: this.cfg.smtpSecure,
      auth: this.cfg.smtpUser
        ? { user: this.cfg.smtpUser, pass: this.cfg.smtpPassword }
        : undefined,
      connectionTimeout: this.cfg.timeoutMs,
      greetingTimeout: this.cfg.timeoutMs,
      socketTimeout: this.cfg.timeoutMs,
      tls: { rejectUnauthorized: this.cfg.tlsRejectUnauthorized },
    });
    return this.transporter;
  }

  onModuleDestroy(): void {
    this.transporter?.close();
  }
}

/** Keep the first character of the local part + the domain, e.g. `a***@hamad.qa`. */
export function maskEmail(email: string): string {
  if (!email) return '(no email)';
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}
