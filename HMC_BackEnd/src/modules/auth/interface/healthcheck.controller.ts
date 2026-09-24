import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@core/auth/decorators/public.decorator';
import { SkipEnvelope } from '@core/http/response.interceptor';
import { SkipIntegrity } from '@core/integrity/skip-integrity.decorator';
import { HealthCheckService } from '../application/healthcheck.service';
import { HealthCheckRequestDto, HealthCheckResponseDto } from './dto/healthcheck.dto';

/** API-1 — App-launch health check (downtime + forced/optional update). */
@ApiTags('auth')
// The first call the app makes, before it has attested (a fresh iOS install
// still has to register its key), and it carries nothing worth protecting:
// downtime + update flags. Attesting it would hide a forced-update notice
// from exactly the devices that need it.
@SkipIntegrity()
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
