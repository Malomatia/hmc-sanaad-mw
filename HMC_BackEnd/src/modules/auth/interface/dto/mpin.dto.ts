import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
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

/** API-7 — Reset MPIN (OTP + new MPIN). */
export class ResetMpinRequestDto extends ClientContextDto {
  @ApiProperty({ example: '4321', description: 'New MPIN (client-hashed).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  newmpin!: string;

  @ApiProperty({ example: '987654' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(12)
  otp!: string;

  @ApiProperty({ example: '13131313123' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(43)
  requestid!: string;
}
