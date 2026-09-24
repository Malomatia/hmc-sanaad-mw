import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';

/**
 * Global module exposing the SMTP EmailService (nodemailer): the OTP email
 * fallback for users without a mobile number (auth module's
 * EmailOtpDeliveryAdapter) and the POST /diagnostics/email/test endpoint.
 */
@Global()
@Module({
  controllers: [],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
