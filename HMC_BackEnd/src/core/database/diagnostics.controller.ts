import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { DiagnosticsEnabledGuard } from '../http/diagnostics-enabled.guard';
import {
  OracleCallOp,
  OracleCallStatus,
  OracleLogStore,
} from './oracle-log.store';
import { SkipIntegrity } from '../integrity/skip-integrity.decorator';

/** Query filters for GET /diagnostics/oracle-logs. */
export class OracleLogQueryDto {
  @IsOptional()
  @IsIn(['success', 'error'])
  status?: OracleCallStatus;

  @IsOptional()
  @IsIn(['query', 'call', 'callCursor'])
  op?: OracleCallOp;

  @IsOptional()
  @IsString()
  object?: string;

  @IsOptional()
  @IsString()
  enum?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  oraCode?: number;

  @IsOptional()
  @IsString()
  since?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

/**
 * Diagnostics API over the in-memory Oracle call log (see OracleLogStore).
 * Lets you list/filter every Oracle call the backend made (object, binds,
 * duration, status, ORA code, correlation id) - the structured view of the
 * `[ora#N]` console logs. In-memory only; cleared on restart.
 *
 * The whole controller disappears (404) with DIAGNOSTICS_ENABLED=false.
 */
@UseGuards(DiagnosticsEnabledGuard)
@ApiTags('diagnostics')
// Investigated with curl and Postman, never from the app.
@SkipIntegrity()
@Controller('diagnostics')
export class DiagnosticsController {
  constructor(private readonly store: OracleLogStore) {}

  @Get('oracle-logs')
  @ApiOperation({ summary: 'List Oracle call logs (filterable)', operationId: 'diag_oracleLogs' })
  list(@Query() query: OracleLogQueryDto) {
    return this.store.list(query);
  }
}
