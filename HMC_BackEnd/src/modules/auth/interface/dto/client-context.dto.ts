import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Common client/device context sent by the mobile app on auth requests.
 * Field names normalized to lowercase (the source doc is inconsistent, e.g.
 * appName/appname); the mobile client must send these keys.
 *
 * `deviceid` is the preferred spelling of the device identifier: the F5 WAF in
 * front of the staging/production hostname rejects bodies carrying the
 * legacy `imeinumber` key (block page, support ID 15468526370063513757,
 * 2026-09-02). Either key is accepted and mirrored to `imeinumber`, which the
 * services keep reading; send exactly one.
 */
export class ClientContextDto {
  @ApiProperty({ example: 'hmc12345', description: 'Employee NT id / username.' })
  @IsString()
  @IsNotEmpty()
  username!: string;

  @ApiPropertyOptional({
    example: 'a5b3d106-8d16-482f-bd4e-8c080a5da203',
    description: 'Device identifier (preferred key — the perimeter WAF flags `imeinumber`).',
  })
  @IsOptional()
  @IsString()
  deviceid?: string;

  @ApiPropertyOptional({
    example: '356789012345678',
    description: 'Device IMEI (legacy key; required unless `deviceid` is sent).',
  })
  // @Expose so the property is visited (and the Transform runs) even when the
  // key is absent from the payload — plain objects only walk their own keys.
  @Expose()
  @Transform(({ value, obj }) => value ?? (obj as ClientContextDto).deviceid)
  @IsString({ message: 'deviceid (or imeinumber) must be a string' })
  @IsNotEmpty({ message: 'deviceid (or imeinumber) should not be empty' })
  imeinumber!: string;

  @ApiPropertyOptional({ example: 'Android' })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional({ example: 'Sanaad' })
  @IsOptional()
  @IsString()
  appname?: string;

  @ApiPropertyOptional({ example: '1.0.0' })
  @IsOptional()
  @IsString()
  version?: string;

  @ApiPropertyOptional({ example: '2026-01-02T14:20:00' })
  @IsOptional()
  @IsString()
  sysdate?: string;
}
