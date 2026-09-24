import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { SkipEnvelope } from '../http/response.interceptor';
import { SkipIntegrity } from '../integrity/skip-integrity.decorator';

@ApiTags('health')
// Uptime probes are not the mobile app; App Check would fail them all.
@SkipIntegrity()
@Controller('health')
export class HealthController {
  @Public()
  @SkipEnvelope()
  @Get()
  check() {
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
