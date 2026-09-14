import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ClientContextDto } from './client-context.dto';

/**
 * API-2 — User Validate request. Per the auth framework doc, this call carries
 * NO password: the username is looked up in LDAP (existence + valid-employee +
 * registered phone) and an OTP is sent to that phone. Credential proof happens
 * later via OTP (onboarding) and MPIN (login).
 */
export class UserValidateRequestDto extends ClientContextDto {}

/**
 * API-2 — reworked initiate response (client request 2026-09-03). Existing
 * user (device registered with an MPIN): full identity from the employee view
 * + device registration, newuser=No, no OTP. New user/device: registration
 * created, OTP sent, requestid + "OTP sent successfully". Unknown username:
 * status=error, "Invalid Username.".
 */
export class UserValidateResponseDto {
  @ApiPropertyOptional({ example: 'employee nt id' })
  employeeusername?: string;

  @ApiPropertyOptional({ example: 'Name of employee' })
  employeename?: string;

  @ApiPropertyOptional({ example: '011759' })
  employeenumber?: string;

  @ApiPropertyOptional({ example: 'HICT Programmer.HMC' })
  jobname?: string;

  @ApiPropertyOptional({ example: 'MK****@hamad.qa', description: 'Masked — first 2 characters visible.' })
  email?: string;

  @ApiPropertyOptional({ example: 'Cardiothoracic Surgery.Heart Hospital' })
  department?: string;

  @ApiPropertyOptional({ example: 'Yes', description: 'First-time user flag.' })
  newuser?: string;

  @ApiPropertyOptional({ example: 'Yes', description: 'Valid-employee flag.' })
  employeeflag?: string;

  @ApiPropertyOptional({
    example: 'XXXXX206',
    description: 'Masked — only the last 3 digits visible.',
  })
  employeephonenumber?: string;

  @ApiPropertyOptional({ example: 'Active', description: 'Device registration status.' })
  devicestatus?: string;

  @ApiPropertyOptional({
    example: 'New',
    enum: ['New', 'Pending', 'Exist'],
    description:
      'New = a fresh OTP was stored (inserted/overwritten) · Pending = a still-valid unused ' +
      'OTP already existed and was kept (same requestid) · Exist = existing user (newuser=No), no OTP.',
  })
  vflag?: string;

  @ApiPropertyOptional({
    example: 'SMS',
    enum: ['SMS', 'Email'],
    description: 'Channel of the OTP: SMS to the registered mobile, Email when no phone exists.',
  })
  otpmode?: string;

  @ApiPropertyOptional({
    example: 5,
    description:
      'Minutes the OTP is still valid for: full TTL when vflag=New, remaining time when vflag=Pending.',
  })
  elapsedtimeinmins?: number;

  @ApiPropertyOptional({ example: '12345', description: 'Present when an OTP was sent.' })
  requestid?: string;

  @ApiPropertyOptional({
    example: '012345',
    description: 'Testing only: present with OTP_IN_RESPONSE=true outside production.',
  })
  otp?: string;

  @ApiPropertyOptional({ example: 'success', description: '`error` on failure.' })
  status?: string;

  @ApiPropertyOptional({ example: 'OTP sent successfully' })
  message?: string;
}

/**
 * POST /auth/send-otp — standalone OTP send. Generates the OTP and stores it
 * as a row in the MOTC SMS push table (`MOTC_SMS_PushTable`) — the government
 * gateway picks pending rows up and fires the SMS from their side. The
 * returned requestid (= MessageID) is what /auth/otp/validate expects.
 */
export class SendOtpRequestDto extends ClientContextDto {
  @ApiPropertyOptional({
    example: '55123456',
    description: 'Destination phone number (ToAddress). Omit to deliver by email instead.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  phonenumber?: string;

  @ApiPropertyOptional({
    example: 'aibrahim39@hamad.qa',
    description:
      'Fallback channel for users with NO mobile: the OTP is emailed over SMTP. ' +
      'Used only when phonenumber is absent; one of the two is required (409 otherwise).',
  })
  @IsOptional()
  @IsEmail()
  email?: string;
}

export class SendOtpResponseDto {
  @ApiProperty({ example: 'success' })
  status!: string;

  @ApiPropertyOptional({
    example: '12345',
    description: 'Correlation id (push-table MessageID) — echo it on /auth/otp/validate.',
  })
  requestid?: string;

  @ApiPropertyOptional({
    example: '012345',
    description: 'Testing only: present with OTP_IN_RESPONSE=true outside production.',
  })
  otp?: string;

  @ApiPropertyOptional({ description: 'Present on failure.' })
  message?: string;
}

/** API-3 — Validate OTP request. */
export class ValidateOtpRequestDto extends ClientContextDto {
  @ApiProperty({ example: '232323' })
  @IsString()
  @IsNotEmpty()
  otp!: string;

  @ApiProperty({ example: '13131313123', description: 'Correlation id from User Validate.' })
  @IsString()
  @IsNotEmpty()
  requestid!: string;
}
