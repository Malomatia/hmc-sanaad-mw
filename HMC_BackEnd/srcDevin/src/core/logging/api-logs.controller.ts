import { Controller, Delete, Get, Header, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { SkipEnvelope } from '../http/response.interceptor';
import { DiagnosticsEnabledGuard } from '../http/diagnostics-enabled.guard';
import { ApiLogQueryDto } from './dto/api-log-query.dto';
import { ApiLogsService } from './api-logs.service';
import { API_LOG_VIEW_HTML } from './api-log.view';

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

  @SkipEnvelope()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
      "style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:;",
  )
  @ApiExcludeEndpoint()
  @Get('view')
  view(): string {
    return API_LOG_VIEW_HTML;
  }

  @Get('statistics')
  @ApiOperation({
    summary: 'Dashboard aggregates (cards + charts)',
    operationId: 'apiLogs_statistics',
  })
  statistics(@Query('slowThresholdMs') slowThresholdMs?: string) {
    return this.service.statistics(slowThresholdMs ? Number(slowThresholdMs) : undefined);
  }

  @Get('errors')
  @ApiOperation({ summary: 'Failed requests only', operationId: 'apiLogs_errors' })
  errors(@Query() query: ApiLogQueryDto) {
    return this.service.errors(query);
  }

  @Get('success')
  @ApiOperation({ summary: 'Successful requests only', operationId: 'apiLogs_success' })
  success(@Query() query: ApiLogQueryDto) {
    return this.service.success(query);
  }

  @Get('slow')
  @ApiOperation({
    summary: 'Requests slower than a threshold (default 1000ms)',
    operationId: 'apiLogs_slow',
  })
  slow(@Query() query: ApiLogQueryDto) {
    return this.service.slow(query);
  }

  @Delete()
  @ApiOperation({ summary: 'Clear the in-memory API log buffer', operationId: 'apiLogs_clear' })
  clear() {
    return this.service.clear();
  }

  @Get()
  @ApiOperation({
    summary:
      'List API logs (filter by method, endpoint, status, user, error category, date range…)',
    operationId: 'apiLogs_list',
  })
  list(@Query() query: ApiLogQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Full detail of one API log entry (incl. stack trace)',
    operationId: 'apiLogs_getById',
  })
  getById(@Param('id', ParseIntPipe) id: number) {
    return this.service.getById(id);
  }
}
