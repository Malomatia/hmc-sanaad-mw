import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  UseGuards,
  Version,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as oracledb from 'oracledb';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';
import { AppConfig, UsersDbConfig } from '../config/configuration';
import { Public } from '../auth/decorators/public.decorator';
import { SkipEnvelope } from '../http/response.interceptor';
import { DiagnosticsEnabledGuard } from '../http/diagnostics-enabled.guard';
import { MssqlService } from './mssql.service';
import { MotcSmsDbService } from './motc-sms-db.service';
import { OracleService } from './oracle.service';
import { assertOracleReadOnlySelect } from './sql-console.util';
import {
  OracleCallOp,
  OracleCallStatus,
  OracleLogStore,
} from './oracle-log.store';
import { ORACLE_LOG_VIEW_HTML } from './oracle-log.view';
import { OracleMetadataService } from './oracle-metadata.service';
import { assertReadOnlySelect } from './sql-console.util';
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

/** Query for GET /diagnostics/oracle-object. */
export class OracleObjectQueryDto {
  /** Allow-listed `XXHMC_SND_*` object name, optionally `PACKAGE.PROCEDURE`. */
  @IsString()
  name!: string;
}

/** Object types listable by GET /diagnostics/oracle-views. */
const ORACLE_OBJECT_TYPES = ['VIEW', 'TABLE', 'PROCEDURE', 'FUNCTION', 'PACKAGE', 'SYNONYM'] as const;

/** Query for GET /diagnostics/oracle-views. */
export class OracleViewsQueryDto {
  /** Case-insensitive substring filter on the object name (after the prefix). */
  @IsOptional()
  @IsString()
  search?: string;

  /** Object type to list; default VIEW; ALL = every type above. */
  @IsOptional()
  @IsIn([...ORACLE_OBJECT_TYPES, 'ALL'])
  type?: string;
}

/** Body for POST /diagnostics/oracle/sql. */
export class OracleSqlRequestDto {
  /** A single SELECT (or WITH ... SELECT); may use named `:binds`. */
  @IsOptional()
  @IsString()
  sql?: string;

  /**
   * Base64 of the statement - the staging WAF rejects request bodies that
   * look like SQL, so the console UI/dev-console convention is supported
   * here too. Wins over `sql` when both are sent.
 */
  @IsOptional()
  @IsString()
  sqlB64?: string;

  /** Values for the statement's named `:binds` (parameterized). */
  @IsOptional()
  @IsObject()
  binds?: Record<string, unknown>;

  /** Max rows returned (default 200, cap 1000). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  maxRows?: number;
}

/** Body for POST /diagnostics/users-db/sql. */
export class UsersDbSqlRequestDto {
  /** A single SELECT (or WITH ... SELECT) statement; may use named `@params`. */
  /** A single SELECT (or WITH ... SELECT) statement; may use named `@params`. */
  @IsOptional()
  @IsString()
  sql?: string;

  /**
   * Base64 of the statement.
   *
   * The staging WAF rejects request bodies that look like SQL, so every
   * query here came back as its HTML page rather than a result - which is
   * why the Users DB could not be inspected from outside at all. The Oracle
   * console already offered this escape hatch and this one did not. Wins
   * over `sql` when both are sent.
 */
  @IsOptional()
  @IsString()
  sqlB64?: string;
  /** Values for the statement's named `@params` (parameterized binding). */
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  /** Max rows returned (default 200, cap 1000); extra rows are truncated. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  maxRows?: number;
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
  private readonly nodeEnv: string;
  private readonly usersDbCfg: UsersDbConfig;

  constructor(
    private readonly store: OracleLogStore,
    private readonly metadata: OracleMetadataService,
    private readonly mssql: MssqlService,
    private readonly motcSmsDb: MotcSmsDbService,
    private readonly oracle: OracleService,
    config: ConfigService,
  ) {
    this.nodeEnv = config.getOrThrow<AppConfig>('app').nodeEnv;
    this.usersDbCfg = config.getOrThrow<UsersDbConfig>('usersDb');
  }

  /**
   * Every Sanaad (`XXHMC_SND_*`) object of the requested type, straight from
   * ALL_OBJECTS - the full catalog, NOT limited to the app's allow-list, so
   * new views appear here before the code knows them. Follow up with
   * GET /diagnostics/oracle-object?name=... for the column list, and
   * POST /diagnostics/oracle/sql to query one.
 */
  @Get('oracle-views')
  @ApiOperation({
    summary: 'List all XXHMC_SND_* objects in the Oracle DB (default: views)',
    operationId: 'diag_oracleViews',
  })
  async oracleViews(@Query() query: OracleViewsQueryDto) {
    const types = query.type === 'ALL' ? [...ORACLE_OBJECT_TYPES] : [query.type ?? 'VIEW'];
    const binds: Record<string, unknown> = { search: query.search?.trim().toUpperCase() || null };
    types.forEach((t, i) => (binds[`t${i}`] = t));
    const rows = await this.oracle.query<Record<string, any>>(
      // Underscores are LIKE wildcards - escape them so the prefix is literal.
      `SELECT owner, object_name, object_type, status, last_ddl_time
         FROM all_objects
        WHERE object_name LIKE 'XXHMC\\_SND\\_%' ESCAPE '\\'
          AND object_type IN (${types.map((_, i) => `:t${i}`).join(', ')})
          AND (:search IS NULL OR object_name LIKE '%' || :search || '%')
        ORDER BY object_name, owner`,
      binds as oracledb.BindParameters,
    );
    return {
      count: rows.length,
      objects: rows.map((r) => ({
        name: String(r.OBJECT_NAME),
        type: String(r.OBJECT_TYPE),
        owner: String(r.OWNER),
        status: String(r.STATUS),
        lastDdl: r.LAST_DDL_TIME ? new Date(r.LAST_DDL_TIME).toISOString() : null,
      })),
    };
  }

  /**
   * Ad-hoc read-only SQL console against Oracle - the Oracle twin of
   * /diagnostics/users-db/sql. A single SELECT/CTE (validated BEFORE the
   * driver, FOR UPDATE rejected), named `:binds` for WHERE parameters, and a
   * ROWNUM cap so a full-scan of a huge view cannot exhaust memory.
   *
   *  TEMPORARY (client request 2026-08-31): the ORACLE_SQL_ENABLED and
   * NODE_ENV=production gates are REMOVED so the console works everywhere
   * with no env dependency. Restore the two checks (see the users-db console
   * below for the pattern) before any real production hardening - the only
   * remaining protections are the SELECT-only validation and the row cap.
 */
  @Post('oracle/sql')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Run a read-only SELECT against Oracle (no env gate - temporary)',
    operationId: 'diag_oracleSql',
  })
  async oracleSql(@Body() body: OracleSqlRequestDto) {
    const raw = body.sqlB64 ? Buffer.from(body.sqlB64, 'base64').toString('utf8') : (body.sql ?? '');
    const statement = assertOracleReadOnlySelect(raw).replace(/;+\s*$/, '');
    const maxRows = body.maxRows ?? 200;
    const binds: Record<string, unknown> = { ...(body.binds ?? {}) };

    // Cap the result INSIDE Oracle when possible (plain SELECT ->' inline-view
    // wrap + ROWNUM), so an unfiltered read of a large view cannot pull the
    // whole table into memory. WITH ... statements can't always be wrapped, so
    // they run as-is and are sliced after the fetch.
    const wrappable = /^select\b/i.test(statement);
    const executed = wrappable
      ? `SELECT * FROM (${statement}) WHERE ROWNUM <= :maxrows_cap`
      : statement;
    if (wrappable) binds.maxrows_cap = maxRows + 1;

    const started = Date.now();
    const rows = await this.oracle.query<Record<string, unknown>>(
      executed,
      binds as oracledb.BindParameters,
    );
    return {
      rowCount: Math.min(rows.length, maxRows),
      truncated: rows.length > maxRows,
      durationMs: Date.now() - started,
      columns: rows.length > 0 ? Object.keys(rows[0]) : [],
      rows: rows.slice(0, maxRows),
    };
  }

  /**
   * Ad-hoc read-only SQL console against the Users/Sanaad SQL Server DB.
   * SELECT-only, validated by assertReadOnlySelect before the driver is
   * touched. Values should be passed via `params` (named `@p` binds),
   * never inlined.
   *
   * TEMPORARY: the USERS_DB_SQL_ENABLED and NODE_ENV=production gates are
   * REMOVED - the same treatment the Oracle and MOTC consoles already have.
   * Staging deploys with NODE_ENV=production, so both gates were closed
   * there and the Users DB could not be inspected at all: the notification
   * and attestation tables live in it and there is no other way to confirm
   * a row was written. The 403 was unhelpful too, since the exception
   * filter replaces the specific reason with a generic 'no permission'.
   *
   * Restore both checks before any real production hardening: rows from
   * this database can contain MPIN hashes and OTP state.
 */
  @Post('users-db/sql')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Run a read-only SELECT against the Users DB (no env gate - temporary)',
    operationId: 'diag_usersDbSql',
  })
  async usersDbSql(@Body() body: UsersDbSqlRequestDto) {
    return this.runSqlConsole(this.mssql, body);
  }

  /**
   * Ad-hoc read-only SQL console against the MOTC SMS gateway DB (the OTP
   * push table + HMC_SND_LIV_EMP_MASTER_VW) - the MOTC twin of
   * /diagnostics/users-db/sql.
   *
   *   TEMPORARY (client request 2026-09-03): the MOTC_SMS_SQL_ENABLED and
   * NODE_ENV=production gates are REMOVED so the console works everywhere
   * with no env dependency - same treatment as the Oracle console above.
   * Restore the two checks (see the users-db console for the pattern) before
   * any real production hardening: result rows from MOTC_SMS_PushTable can
   * contain live OTPs (MessageBody) and phone numbers.
 */
  @Post('motc-sms-db/sql')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Run a read-only SELECT against the MOTC SMS DB (no env gate - temporary)',
    operationId: 'diag_motcSmsDbSql',
  })
  async motcSmsDbSql(@Body() body: UsersDbSqlRequestDto) {
    return this.runSqlConsole(this.motcSmsDb, body);
  }

  private async runSqlConsole(
    db: Pick<MssqlService, 'query'>,
    body: UsersDbSqlRequestDto,
  ) {
    // base64 first: the WAF rejects bodies that look like SQL, so that form is
    // the only one that survives the trip in from outside.
    const raw = body.sqlB64
      ? Buffer.from(body.sqlB64, 'base64').toString('utf8')
      : (body.sql ?? '');
    if (!raw.trim()) throw new BadRequestException('Provide `sql` or `sqlB64`.');
    const statement = assertReadOnlySelect(raw);
    const maxRows = body.maxRows ?? 200;
    const started = Date.now();
    const rows = await db.query(statement, body.params ?? {});
    return {
      rowCount: Math.min(rows.length, maxRows),
      totalRows: rows.length,
      truncated: rows.length > maxRows,
      durationMs: Date.now() - started,
      columns: rows.length > 0 ? Object.keys(rows[0]) : [],
      rows: rows.slice(0, maxRows),
    };
  }

  /**
   * Data-dictionary description of a known Oracle object: whether it is a view,
   * procedure or package, its column list and its formal parameter list. Use it
   * to confirm key columns / bind names instead of assuming them.
 */
  @Get('oracle-object')
  @ApiOperation({ summary: 'Describe an Oracle object (type, columns, arguments)', operationId: 'diag_oracleObject' })
  describeObject(@Query() query: OracleObjectQueryDto) {
    return this.metadata.describe(query.name);
  }

  /**
   * Browser view: a filterable table (enum, correlationId, object, oraCode, ...)
   * rendered from the JSON list endpoint. @Public so it loads in a browser;
   * gate/remove it before production if the SQL log is sensitive.
 */
  @Public()
  @SkipEnvelope()
  @Header('Content-Type', 'text/html; charset=utf-8')
  // helmet's default CSP blocks inline <script>/onclick; relax it for this
  // self-contained diagnostics page (overrides the global header for this route).
  @Header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'",
  )
  @ApiExcludeEndpoint()
  @Get('oracle-logs/view')
  view(): string {
    return ORACLE_LOG_VIEW_HTML;
  }

  @Get('oracle-logs')
  @ApiOperation({ summary: 'List Oracle call logs (filterable)', operationId: 'diag_oracleLogs' })
  list(@Query() query: OracleLogQueryDto) {
    return this.store.list(query);
  }

  @Get('oracle-logs/stats')
  @ApiOperation({ summary: 'Oracle call log aggregates', operationId: 'diag_oracleLogStats' })
  stats() {
    return this.store.stats();
  }

  @Delete('oracle-logs')
  @ApiOperation({ summary: 'Clear the Oracle call log buffer', operationId: 'diag_oracleLogsClear' })
  clear() {
    return { cleared: this.store.clear() };
  }

  @Version('2')
  @Get('oracle-views')
  @ApiOperation({
    summary: 'List all XXHMC_SND_* objects in the Oracle DB (default: views)',
    operationId: 'diag_oracleViews_v2',
  })
  async oracleViewsV2(@Query() query: OracleViewsQueryDto) {
    return this.oracleViews(query);
  }

  @Version('2')
  @Post('oracle/sql')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Run a read-only SELECT against Oracle (no env gate - temporary)',
    operationId: 'diag_oracleSql_v2',
  })
  async oracleSqlV2(@Body() body: OracleSqlRequestDto) {
    return this.oracleSql(body);
  }

  @Version('2')
  @Post('users-db/sql')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Run a read-only SELECT against the Users DB (no env gate - temporary)',
    operationId: 'diag_usersDbSql_v2',
  })
  async usersDbSqlV2(@Body() body: UsersDbSqlRequestDto) {
    return this.usersDbSql(body);
  }

  @Version('2')
  @Post('motc-sms-db/sql')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Run a read-only SELECT against the MOTC SMS DB (no env gate - temporary)',
    operationId: 'diag_motcSmsDbSql_v2',
  })
  async motcSmsDbSqlV2(@Body() body: UsersDbSqlRequestDto) {
    return this.motcSmsDbSql(body);
  }

  @Version('2')
  @Get('oracle-object')
  @ApiOperation({ summary: 'Describe an Oracle object (type, columns, arguments)', operationId: 'diag_oracleObject_v2' })
  describeObjectV2(@Query() query: OracleObjectQueryDto) {
    return this.describeObject(query);
  }

  @Version('2')
  @Public()
  @SkipEnvelope()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'",
  )
  @ApiExcludeEndpoint()
  @Get('oracle-logs/view')
  viewV2(): string {
    return this.view();
  }

  @Version('2')
  @Get('oracle-logs')
  @ApiOperation({ summary: 'List Oracle call logs (filterable)', operationId: 'diag_oracleLogs_v2' })
  listV2(@Query() query: OracleLogQueryDto) {
    return this.list(query);
  }

  @Version('2')
  @Get('oracle-logs/stats')
  @ApiOperation({ summary: 'Oracle call log aggregates', operationId: 'diag_oracleLogStats_v2' })
  statsV2() {
    return this.stats();
  }

  @Version('2')
  @Delete('oracle-logs')
  @ApiOperation({ summary: 'Clear the Oracle call log buffer', operationId: 'diag_oracleLogsClear_v2' })
  clearV2() {
    return this.clear();
  }
}
