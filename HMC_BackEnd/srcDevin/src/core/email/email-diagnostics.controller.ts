import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { DiagnosticsEnabledGuard } from '../http/diagnostics-enabled.guard';
import { EmailService } from './email.service';

/** Body for POST /diagnostics/email/test. */
export class TestEmailRequestDto {
  /** Recipient address. */
  @IsEmail()
  @IsNotEmpty()
  to!: string;

  /** Optional subject (defaults to a generic test subject). */
  @IsOptional()
  @IsString()
  subject?: string;

  /** Optional plain-text body (defaults to a timestamped test message). */
  @IsOptional()
  @IsString()
  message?: string;
}

/**
 * Diagnostics endpoint verifying the SMTP configuration end-to-end: sends a
 * real test email through EmailService (the same path OTP emails take).
 * `sent=false` means SMTP_HOST is not configured (non-production log-only
 * mode); an unreachable/rejecting relay surfaces as 503.
 *
 * Disappears (404) with DIAGNOSTICS_ENABLED=false, like the rest of the
 * /diagnostics group.
 */
@UseGuards(DiagnosticsEnabledGuard)
@ApiTags('diagnostics')
@Controller('diagnostics')
export class EmailDiagnosticsController {
  constructor(private readonly email: EmailService) {}

  @Post('email/test')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Send a test email through the configured SMTP relay',
    operationId: 'diag_emailTest',
  })
  async testEmail(@Body() body: TestEmailRequestDto) {
    const started = Date.now();
    const sent = await this.email.send({
      to: body.to,
      subject: body.subject ?? 'Sanaad test email',
      text:
        body.message ??
        `This is a test email from the Sanaad backend, sent at ${new Date().toISOString()}.`,
    });
    return {
      status: 'success',
      sent,
      smtpConfigured: this.email.isConfigured,
      durationMs: Date.now() - started,
    };
  }
}
