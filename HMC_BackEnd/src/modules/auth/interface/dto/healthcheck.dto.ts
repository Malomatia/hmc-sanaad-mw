import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * API-1 — Health Check request (app launch). Note: uses `deviceimei` (not
 * `imeinumber`). `deviceid` is the preferred alias here too — see
 * ClientContextDto for the WAF rationale; either key mirrors to `deviceimei`.
 */
export class HealthCheckRequestDto {
  @ApiPropertyOptional({
    example: 'a5b3d106-8d16-482f-bd4e-8c080a5da203',
    description: 'Device identifier (preferred key — the perimeter WAF flags IMEI-named keys).',
  })
  @IsOptional()
  @IsString()
  deviceid?: string;

  @ApiPropertyOptional({
    example: '356789012345678',
    description: 'Device IMEI (legacy key; required unless `deviceid` is sent).',
  })
  // @Expose so the Transform runs even when the key is absent — see ClientContextDto.
  @Expose()
  @Transform(({ value, obj }) => value ?? (obj as HealthCheckRequestDto).deviceid)
  @IsString({ message: 'deviceid (or deviceimei) must be a string' })
  @IsNotEmpty({ message: 'deviceid (or deviceimei) should not be empty' })
  deviceimei!: string;

  @ApiPropertyOptional({ example: 'Android' })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional({ example: '2026-01-02T14:10:00' })
  @IsOptional()
  @IsString()
  sysdate?: string;

  @ApiPropertyOptional({ example: 'Sanaad' })
  @IsOptional()
  @IsString()
  appname?: string;

  @ApiPropertyOptional({ example: '1.0.0' })
  @IsOptional()
  @IsString()
  version?: string;
}

export class HealthCheckResponseDto {
  @ApiProperty({ example: 'No', enum: ['Yes', 'No'] })
  appDowntime!: string;

  @ApiProperty({ example: '' })
  downtimeStart!: string;

  @ApiProperty({ example: '' })
  downtimeEnd!: string;

  @ApiProperty({
    example: 'R',
    description: 'Update requirement: R = not required, O = optional, M = mandatory.',
  })
  updatetype!: string;
}
