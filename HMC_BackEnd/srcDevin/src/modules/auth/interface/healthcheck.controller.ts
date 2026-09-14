import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@core/auth/decorators/public.decorator';
import { SkipEnvelope } from '@core/http/response.interceptor';
import { HealthCheckService } from '../application/healthcheck.service';
import { HealthCheckRequestDto, HealthCheckResponseDto } from './dto/healthcheck.dto';

/** API-1 — App-launch health check (downtime + forced/optional update). */
@ApiTags('auth')
@Controller('healthcheck')
export class HealthCheckController {
  constructor(private readonly service: HealthCheckService) {}

  @Public()
  @SkipEnvelope()
  @HttpCode(200)
  @Post()
  @ApiOperation({ summary: 'API-1 — Health Check (app launch)', operationId: 'auth_healthCheck' })
  @ApiOkResponse({ type: HealthCheckResponseDto })
  check(@Body() dto: HealthCheckRequestDto): Promise<HealthCheckResponseDto> {
    return this.service.check(dto);
  }
}
