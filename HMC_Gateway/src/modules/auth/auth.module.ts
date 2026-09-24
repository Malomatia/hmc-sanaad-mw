import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { HealthCheckController } from './healthcheck.controller';
import { AppSettingController } from './app-setting.controller';
import { AppIntegrityController } from './app-integrity.controller';
import { ProxyCoreModule } from '../proxy/proxy-core.module';

@Module({
  imports: [ThrottlerModule, ProxyCoreModule],
  controllers: [AuthController, HealthCheckController, AppSettingController, AppIntegrityController],
})
export class AuthModule {}
