import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Public } from '../auth/decorators/public.decorator';
import { BackendConfig } from '../config/configuration';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /** Gateway liveness only — no upstream dependency. */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Gateway liveness', operationId: 'health_check' })
  check() {
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /** Dependency check — pings HMC_BackEnd's own /health. */
  @Public()
  @Get('backend')
  @ApiOperation({ summary: 'Backend connectivity check', operationId: 'health_backend' })
  async backend() {
    const backend = this.config.getOrThrow<BackendConfig>('backend');
    const url = `${backend.baseUrl.replace(/\/+$/, '')}/${backend.apiPrefix}/health`;
    try {
      const res = await firstValueFrom(this.http.get(url, { timeout: 5000 }));
      return { status: 'ok', backendStatus: res.status, backend: res.data };
    } catch {
      return { status: 'error', message: 'Backend unavailable.' };
    }
  }
}
