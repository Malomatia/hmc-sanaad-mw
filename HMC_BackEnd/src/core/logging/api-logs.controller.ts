import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { DiagnosticsEnabledGuard } from '../http/diagnostics-enabled.guard';
import { ApiLogQueryDto } from './dto/api-log-query.dto';
import { ApiLogsService } from './api-logs.service';

/**
 * API request/response monitoring — read-only over the log captured
 * automatically by ApiLogInterceptor. `@Public()` on every route: no ADMIN
 * role exists in this app yet, and the equivalent Oracle-log diagnostics
 * (`/diagnostics/oracle-logs`) follow the same open pattern. Gate this module
 * (e.g. `@Roles(Role.ADMIN)` once introduced) before exposing it outside a
 * trusted network — it can reveal stack traces and request bodies.
 *
 * The whole controller disappears (404) with DIAGNOSTICS_ENABLED=false.
 */
@UseGuards(DiagnosticsEnabledGuard)
@Public()
@ApiTags('api-logs')
@Controller('api-logs')
export class ApiLogsController {
  constructor(private readonly service: ApiLogsService) {}

  @Get()
  @ApiOperation({
    summary:
      'List API logs (filter by method, endpoint, status, user, error category, date range…)',
    operationId: 'apiLogs_list',
  })
  list(@Query() query: ApiLogQueryDto) {
    return this.service.list(query);
  }
}
