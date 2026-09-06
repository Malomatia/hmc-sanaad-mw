import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { DevicePlatform } from '../../domain/device-token';

export class RegisterDeviceTokenDto {
  @ApiProperty({
    example: 'fH7k...:APA91bH...',
    description: 'The FCM registration token from the app. Send it on every launch — FCM reissues it on reinstall, data clear and periodically on its own.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  token!: string;

  @ApiProperty({
    example: 'a5b3d106-8d16-482f-bd4e-8c080a5da203',
    description: 'The same device identifier sent at login — one registration per device, so re-registering replaces it rather than piling up dead tokens.',
  })
  @IsString()
  @IsNotEmpty()
  imei!: string;

  @ApiPropertyOptional({ enum: ['android', 'ios'], example: 'android' })
  @IsOptional()
  @IsIn(['android', 'ios'])
  platform?: DevicePlatform;

  @ApiPropertyOptional({ example: '1.0.0' })
  @IsOptional()
  @IsString()
  appVersion?: string;
}

export class UnregisterDeviceTokenDto {
  @ApiProperty({ example: 'a5b3d106-8d16-482f-bd4e-8c080a5da203' })
  @IsString()
  @IsNotEmpty()
  imei!: string;
}
