import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ClientContextDto } from './client-context.dto';

/** API-4 — Set MPIN (first-time onboarding, after OTP verified). */
export class SetMpinRequestDto extends ClientContextDto {
  @ApiProperty({ description: 'Single-use enrollmenttoken returned by /auth/otp/validate.' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  enrollmenttoken!: string;

  @ApiProperty({ example: '1234', description: 'New MPIN (client-hashed per framework doc).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  mpin!: string;
}

/** API-6 — Initiate Forgot MPIN (sends OTP). */
export class ForgotMpinInitRequestDto extends ClientContextDto {}

export class ForgotMpinInitResponseDto {
  @ApiProperty({ example: 'initiated successfully' })
  status!: string;

  @ApiPropertyOptional({ example: '13131313123' })
  requestid?: string;

  @ApiPropertyOptional({
    example: 'Device is not registered for this user.',
    description: 'Present on failure.',
  })
  message?: string;
}

/**
 * API-7 — Reset MPIN. Two ways to prove the recovery OTP:
 *  - `enrollmenttoken` from /auth/otp/validate (forgot → validate OTP → reset,
 *    one screen each). The OTP was spent by that validation.
 *  - `otp` + `requestid` from /auth/mpin/forgot, checked here in one call.
 * The token wins when both are sent.
 */
export class ResetMpinRequestDto extends ClientContextDto {
  @ApiProperty({ example: '4321', description: 'New MPIN (client-hashed).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  newmpin!: string;

  @ApiPropertyOptional({
    description: 'Single-use token returned by /auth/otp/validate for the forgot-MPIN OTP.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  enrollmenttoken?: string;

  @ApiPropertyOptional({ example: '987654', description: 'Only without enrollmenttoken.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(12)
  otp?: string;

  @ApiPropertyOptional({ example: '13131313123', description: 'Only without enrollmenttoken.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(43)
  requestid?: string;
}
