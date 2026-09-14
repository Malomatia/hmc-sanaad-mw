import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Role } from '@core/auth/auth-user.interface';
import { FunctionStatus } from '../../domain/auth-identity';
import { ClientContextDto } from './client-context.dto';

/** API-5 — Login request. */
export class LoginRequestDto extends ClientContextDto {
  @ApiProperty({ example: '555407', description: 'MPIN (client-hashed per framework doc).' })
  @IsString()
  @IsNotEmpty()
  mpin!: string;
}

export class FunctionAccessItemDto {
  @ApiProperty({ example: 'Payroll SSRS' })
  functionname!: string;

  @ApiProperty({ example: 'PYSRS' })
  functioncode!: string;

  @ApiPropertyOptional({ example: 'Payroll SSRS' })
  remarks?: string;

  @ApiProperty({ enum: FunctionStatus, example: FunctionStatus.ENABLED })
  status!: FunctionStatus;
}

/** API-5 — Login response (mobile contract; unwrapped via @SkipEnvelope). */
export class LoginResponseDto {
  @ApiProperty({ example: 'success' })
  status!: string;

  @ApiPropertyOptional({ description: 'JWT access token (issued on success).' })
  token?: string;

  @ApiPropertyOptional({ example: 'Bearer' })
  tokenType?: string;

  @ApiPropertyOptional({ example: '1h' })
  expiresIn?: string;

  @ApiPropertyOptional({
    description: 'Refresh token (typ=refresh) for POST /auth/token/refresh — one-time use.',
  })
  refreshtoken?: string;

  @ApiPropertyOptional({ example: 'username' })
  employeeusername?: string;

  @ApiPropertyOptional({ example: '3242424' })
  employeenumber?: string;

  @ApiPropertyOptional({ example: 'name of employee' })
  employeename?: string;

  @ApiPropertyOptional({ example: 'name of employee arabic' })
  employeenamear?: string;

  @ApiPropertyOptional({ example: 'Information Communication and Technology' })
  employeedepartment?: string;

  @ApiPropertyOptional({ example: 'Health Information and Communication Technology' })
  employeecompany?: string;

  @ApiPropertyOptional({ type: [FunctionAccessItemDto] })
  functionaccesslist?: FunctionAccessItemDto[];

  @ApiPropertyOptional({ description: 'Present on failure.' })
  message?: string;
}

export class MeResponseDto {
  @ApiProperty({ example: 'V-NFERNANDO' })
  username!: string;

  @ApiPropertyOptional({ example: '053613' })
  employeeNumber?: string;

  @ApiProperty({ enum: Role, isArray: true })
  roles!: Role[];

  @ApiPropertyOptional({ type: [String], example: ['PYSRS', 'LEAVE'] })
  functions?: string[];
}

/** Generic {status,message} response used by OTP/MPIN endpoints. */
export class StatusMessageDto {
  @ApiProperty({ example: 'success' })
  status!: string;

  @ApiPropertyOptional({ example: 'OTP Validated successfully' })
  message?: string;
}

/** Refresh-token exchange request. */
export class RefreshTokenRequestDto {
  @ApiProperty({ description: 'The refresh token issued by login (or a previous refresh).' })
  @IsString()
  @IsNotEmpty()
  refreshtoken!: string;
}

/** Refresh-token exchange response (Sanaad convention: HTTP 200, status=error on failure). */
export class RefreshTokenResponseDto {
  @ApiProperty({ example: 'success' })
  status!: string;

  @ApiPropertyOptional({ description: 'New JWT access token (issued on success).' })
  token?: string;

  @ApiPropertyOptional({ example: 'Bearer' })
  tokenType?: string;

  @ApiPropertyOptional({ example: '1h' })
  expiresIn?: string;

  @ApiPropertyOptional({ description: 'New refresh token (the used one is revoked).' })
  refreshtoken?: string;

  @ApiPropertyOptional({ description: 'Present on failure.' })
  message?: string;
}

/** Logout request — the refresh token is optional but recommended so the pair dies together. */
export class LogoutRequestDto {
  @ApiPropertyOptional({ description: 'Refresh token to revoke together with the access token.' })
  @IsOptional()
  @IsString()
  refreshtoken?: string;
}
