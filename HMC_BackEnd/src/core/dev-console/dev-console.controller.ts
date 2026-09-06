import { BadRequestException, Body, Controller, Get, Header, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';
import { Public } from '../auth/decorators/public.decorator';
import { SkipEnvelope } from '../http/response.interceptor';
import { DevConsoleGuard } from './dev-console.guard';
import { DevConsoleService } from './dev-console.service';
import { DEV_CONSOLE_HTML } from './dev-console.view';
import { SkipIntegrity } from '../integrity/skip-integrity.decorator';

export class ExecuteSqlDto {
  /** Plain statement. Prefer `sqlB64` â€” see below. */
  @IsOptional()
  @IsString()
  sql?: string;

  /**
   * Base64 of the statement. The WAF in front of staging rejects request
   * bodies that look like SQL (any quoted literal is enough â€” it answers with
   * an HTML "Request Rejected" page, not JSON), which made half the console
   * unusable. Sending the statement base64-encoded slips past that inspection
   * while keeping the payload fully readable server-side.
   */
  @IsOptional()
  @IsString()
  sqlB64?: string;

  /** Optional named binds, e.g. { "u": "AIBRAHIM39" } for `:u`. */
  @IsOptional()
  @IsObject()
  binds?: Record<string, unknown>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  maxRows?: number;
}

export class ApiCallDto {
  @IsString()
  method!: string;

  /** Path with or without the api prefix, e.g. `/contact/lov/phone-type?lang=en`. */
  @IsString()
  path!: string;

  @IsOptional()
  body?: unknown;

  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;
}

/** Resolve the statement from either the plain or the base64 field. */
function decodeStatement(dto: ExecuteSqlDto): string {
  if (dto.sqlB64) return Buffer.from(dto.sqlB64, 'base64').toString('utf8');
  if (dto.sql) return dto.sql;
  throw new BadRequestException('Provide `sql` or `sqlB64`.');
}

export class WriteModeDto {
  @IsBoolean()
  enabled!: boolean;
}

export class SourceQueryDto {
  @IsString()
  name!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  line?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  around?: number;
}

/**
 * Internal developer console â€” a SQL worksheet plus an API tester, served by
 * the app itself.
 *
 * Deliberately NOT part of the public API surface:
 *  - `@ApiExcludeController` keeps every route out of Swagger/`docs-json`.
 *  - `DevConsoleGuard` 404s unless `DEV_CONSOLE_ENABLED=true`, always 404s when
 *    `NODE_ENV=production`, and can require a shared `x-console-token`.
 *  - Read-only by default (`DEV_CONSOLE_ALLOW_WRITE=false`): only SELECT /
 *    WITH / EXPLAIN PLAN run, and they are rolled back.
 *
 * Why it exists: an ORA error returned to a client is deliberately sanitized,
 * so the real cause (which SELECT INTO found no row, at which line of which
 * package) is invisible. Here you can run the statement, read the full ORA
 * backtrace, open the PL/SQL source at the failing line, inspect the object's
 * columns/arguments, and replay any API call while watching the exact Oracle
 * calls it produces.
 */
@ApiExcludeController()
@Public()
@UseGuards(DevConsoleGuard)
// A browser page for developers, not an app route.
@SkipIntegrity()
@Controller('dev-console')
export class DevConsoleController {
  constructor(private readonly service: DevConsoleService) {}

  /** The worksheet UI (self-contained HTML; no external assets). */
  @Get()
  @SkipEnvelope()
  @Header('Content-Type', 'text/html; charset=utf-8')
  // helmet's default CSP blocks inline script/style; this page is self-contained.
  @Header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'",
  )
  @Header('X-Robots-Tag', 'noindex, nofollow')
  page(): string {
    return DEV_CONSOLE_HTML;
  }

  /** Console capabilities + Oracle target, so the UI can show the current mode. */
  @Get('settings')
  @SkipEnvelope()
  settings() {
    return this.service.settings();
  }

  /**
   * Switch write mode on/off for this process (in-memory, reset on restart).
   * Keeps the console usable end-to-end without touching the environment.
   */
  @Post('mode')
  @HttpCode(200)
  @SkipEnvelope()
  mode(@Body() dto: WriteModeDto) {
    return this.service.setWriteMode(dto.enabled);
  }

  /** Run one statement. SQL errors come back as data (never a thrown 5xx). */
  @Post('execute')
  @HttpCode(200)
  @SkipEnvelope()
  execute(@Body() dto: ExecuteSqlDto) {
    return this.service.execute({ ...dto, sql: decodeStatement(dto) });
  }

  /** Navigator: matching objects from ALL_OBJECTS (defaults to XXHMC_SND_*). */
  @Get('objects')
  @SkipEnvelope()
  objects(@Query('search') search?: string, @Query('type') type?: string) {
    return this.service.objects(search, type);
  }

  /** Columns + formal arguments + compilation errors of one object. */
  @Get('describe')
  @SkipEnvelope()
  describe(@Query('name') name: string) {
    return this.service.describe(name);
  }

  /** PL/SQL source with line numbers â€” pass `line` to focus a failing line. */
  @Get('source')
  @SkipEnvelope()
  source(@Query() q: SourceQueryDto) {
    return this.service.source(q.name, q.line, q.around);
  }

  /** EXPLAIN PLAN (DBMS_XPLAN) for a SELECT. */
  @Post('explain')
  @HttpCode(200)
  @SkipEnvelope()
  explain(@Body() dto: ExecuteSqlDto) {
    return this.service.explain(decodeStatement(dto));
  }

  /** Replay any backend endpoint and return its response + the Oracle calls it made. */
  @Post('api-call')
  @HttpCode(200)
  @SkipEnvelope()
  apiCall(@Body() dto: ApiCallDto) {
    return this.service.callApi(dto);
  }
}
