import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  OtpPort,
  SendOtpCommand,
  SendOtpResult,
  VerifyOtpCommand,
} from '../../domain/ports/otp.port';

/**
 * Stub OTP adapter. Throws 501 until the SMS/OTP provider + OTP store are
 * provided. In non-production the services short-circuit (dev bypass).
 * TODO(spec): implement send/verify against the OTP provider (APIs 2/3/6/7).
 */
@Injectable()
export class OtpStubRepository implements OtpPort {
  send(_cmd: SendOtpCommand): Promise<SendOtpResult> {
    throw new NotImplementedException(
      'OTP delivery is not wired yet — provide the SMS/OTP provider spec. [TODO(spec)]',
    );
  }

  verify(_cmd: VerifyOtpCommand): Promise<boolean> {
    throw new NotImplementedException(
      'OTP verification is not wired yet — provide the OTP store spec. [TODO(spec)]',
    );
  }
}
