import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@core/auth/decorators/public.decorator';
import { SkipEnvelope } from '@core/http/response.interceptor';
import { AppSettingService } from '../application/app-setting.service';
import { AppSettingResponseDto } from './dto/app-setting.dto';

/** Public app settings (terms & conditions) — read from env, no token required. */
@ApiTags('auth')
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
