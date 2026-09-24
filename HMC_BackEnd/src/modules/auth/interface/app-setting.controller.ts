import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@core/auth/decorators/public.decorator';
import { SkipEnvelope } from '@core/http/response.interceptor';
import { SkipIntegrity } from '@core/integrity/skip-integrity.decorator';
import { AppSettingService } from '../application/app-setting.service';
import { AppSettingResponseDto } from './dto/app-setting.dto';

/** Public app settings (terms & conditions) — read from env, no token required. */
@ApiTags('auth')
// Launch-time static configuration, same class as /healthcheck: read before
// the device has attested, and nothing in it is per-user or secret.
@SkipIntegrity()
@Controller('app-setting')
export class AppSettingController {
  constructor(private readonly service: AppSettingService) {}

  @Public()
  @SkipEnvelope()
  @Get()
  @ApiOperation({ summary: 'App settings (terms & conditions)', operationId: 'auth_appSetting' })
  @ApiOkResponse({ type: AppSettingResponseDto })
  get(): AppSettingResponseDto {
    return this.service.get();
  }
}
