import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sql from 'mssql';
import { MotcSmsConfig } from '../config/configuration';
import { MssqlDiagnostics, MssqlExecuteResult } from './mssql.service';
import { MssqlQueryError, MssqlUnavailableException } from './mssql.error';

/**
 * Connection pool for the MOTC SMS gateway SQL Server (`MOTC_SMS` database,
 * named instance with a static port — e.g. HSHCL7VVSQ1\SQL1:9001). The third
 * database next to Oracle and the Users DB; it holds `MOTC_SMS_PushTable`,
 * the government SMS outbox that now carries (and validates) the login OTPs.
 *
 * Same boot semantics as MssqlService: MOTC_SMS_DB_DISABLED=true or missing
 * host/database/user skips pool creation and calls fail with a typed
 * unavailable exception. Parameterized primitives only (named `@params`).
 *
 * Log redaction is stricter than the Users DB pool: `MessageBody` carries the
 * raw OTP and `ToAddress` the full phone number, so both are masked.
 */
@Injectable()
export class MotcSmsDbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MotcSmsDbService.name);
  private pool: sql.ConnectionPool | undefined;
  private readonly cfg: MotcSmsConfig;
  /** Monotonic counter so each call's log lines can be correlated. */
  private callSeq = 0;

  /** Param keys whose values must never be logged (OTP body + phone number). */
  private static readonly SENSITIVE_PARAM =
    /(mpin|password|pwd|otp|secret|token|messagebody|toaddress|phone)/i;

  constructor(config: ConfigService) {
    this.cfg = config.getOrThrow<MotcSmsConfig>('motcSms');
  }

  async onModuleInit(): Promise<void> {
    if (this.cfg.disabled) {
      this.logger.warn('MOTC_SMS_DB_DISABLED=true — MOTC SMS DB pool not created.');
      return;
    }
    if (!this.cfg.host || !this.cfg.database || !this.cfg.user) {
      this.logger.warn(
        'MOTC SMS DB host/database/user missing — pool not created. OTP send/validate will fail.',
      );
      return;
    }
    // `HOST\INSTANCE` — with a static port (the client-provided setup) the
    // instance name must NOT be passed or tedious would consult the SQL
    // Browser instead; port 0 opts into instance-name resolution.
    const [server, instanceName] = this.cfg.host.split('\\');
    try {
      this.pool = await new sql.ConnectionPool({
        server,
        ...(this.cfg.port > 0 ? { port: this.cfg.port } : {}),
        database: this.cfg.database,
        user: this.cfg.user,
        password: this.cfg.password,
        pool: { min: this.cfg.poolMin, max: this.cfg.poolMax },
        options: {
          encrypt: this.cfg.encrypt,
          trustServerCertificate: this.cfg.trustServerCertificate,
          ...(this.cfg.port > 0 ? {} : { instanceName }),
        },
        requestTimeout: this.cfg.requestTimeoutMs,
        connectionTimeout: this.cfg.connectTimeoutMs,
      }).connect();
      this.pool.on('error', (err) => this.logger.error(`MOTC SMS DB pool error: ${err.message}`));
      this.logger.log(
        `MOTC SMS DB pool created (min=${this.cfg.poolMin}, max=${this.cfg.poolMax}) → ${this.cfg.host}:${this.cfg.port}/${this.cfg.database}`,
      );
      await this.verifyConnectivity();
    } catch (err) {
      // Not rethrown — see the note in OracleService.onModuleInit. getPool()
      // already raises MssqlUnavailableException per request and /health
      // reports motcSmsDb.reachable = false.
      this.logger.error(
        `Failed to create MOTC SMS DB pool: ${(err as Error).message} — starting without it; ` +
          'OTP send/validate will answer 503 until the configuration is fixed.',
      );
    }
  }

  /** Startup probe — logs only, never blocks boot (mirrors MssqlService). */
  private async verifyConnectivity(): Promise<void> {
    try {
      const started = Date.now();
      const result = await this.pool!.request().query<{ dbTime: Date }>(
        'SELECT SYSDATETIMEOFFSET() AS dbTime',
      );
      this.logger.log(
        `MOTC SMS DB connectivity verified in ${Date.now() - started}ms (server time: ${String(result.recordset[0]?.dbTime ?? 'unknown')})`,
      );
    } catch (err) {
      this.logger.error(
        `MOTC SMS DB pool connected but probe query FAILED — OTP calls will fail: ${(err as Error).message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.logger.log('MOTC SMS DB pool closed.');
    }
  }

  /** A usable pool exists. Callers gate real queries on this. */
  isEnabled(): boolean {
    return this.pool !== undefined;
  }

  /** Configured to be used, pool up or not — see OracleService.isConfigured. */
  isConfigured(): boolean {
    return (
      !this.cfg.disabled &&
      Boolean(this.cfg.host) &&
      Boolean(this.cfg.database) &&
      Boolean(this.cfg.user)
    );
  }

  private getPool(): sql.ConnectionPool {
    if (!this.pool) {
      throw new MssqlUnavailableException('The SMS gateway database is currently unavailable.');
    }
    return this.pool;
  }

  /** Parameterized SELECT — returns mapped rows. */
  async query<T = Record<string, any>>(
    statement: string,
    params: Record<string, unknown> = {},
  ): Promise<T[]> {
    const result = await this.run(statement, params);
    return (result.recordset ?? []) as T[];
  }

  /** Parameterized INSERT/UPDATE/DELETE — returns rows affected (+ OUTPUT rows). */
  async execute<T = Record<string, any>>(
    statement: string,
    params: Record<string, unknown> = {},
  ): Promise<MssqlExecuteResult<T>> {
    const result = await this.run(statement, params);
    return {
      rowsAffected: result.rowsAffected.reduce((a, b) => a + b, 0),
      rows: (result.recordset ?? []) as T[],
    };
  }

  private async run(
    statement: string,
    params: Record<string, unknown>,
  ): Promise<sql.IResult<Record<string, any>>> {
    const id = ++this.callSeq;
    const started = Date.now();
    const label = this.describeSql(statement);
    this.logger.log(`[motc#${id}] → ${label} params=${this.formatParams(params)}`);
    const request = this.getPool().request();
    for (const [key, value] of Object.entries(params)) {
      request.input(key, value as sql.ISqlType | unknown);
    }
    try {
      const result = await request.query(statement);
      const ms = Date.now() - started;
      const rows = result.recordset?.length ?? 0;
      this.logger.log(
        `[motc#${id}] done ${label} ${rows} row(s), ${result.rowsAffected} affected (${ms}ms)`,
      );
      return result;
    } catch (err) {
      const ms = Date.now() - started;
      const wrapped = MssqlQueryError.from(err);
      this.logger.error(`[motc#${id}] FAILED ${label} after ${ms}ms: ${wrapped.message}`);
      throw wrapped;
    }
  }

  /** Short label for a statement: the table read or written. */
  private describeSql(statement: string): string {
    const compact = statement.replace(/\s+/g, ' ').trim();
    const target =
      /\bfrom\s+([a-z0-9_$.\[\]]+)/i.exec(compact) ??
      /\b(?:update|insert\s+into|delete\s+from)\s+([a-z0-9_$.\[\]]+)/i.exec(compact);
    if (target) return target[1].toUpperCase();
    return compact.length > 60 ? `${compact.slice(0, 57)}...` : compact;
  }

  /** Lightweight readiness check for the /health endpoint. */
  async ping(): Promise<boolean> {
    if (!this.pool) return false;
    try {
      await this.pool.request().query('SELECT 1 AS ok');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Full connectivity probe for /health/motc-sms-db. Never throws — failures
   * are captured in `error`. Mirrors MssqlService.diagnose.
   */
  async diagnose(): Promise<MssqlDiagnostics> {
    const diag: MssqlDiagnostics = {
      enabled: this.pool !== undefined,
      connected: false,
      latencyMs: null,
      connection: {
        user: this.cfg.user || '(not set)',
        server: this.cfg.host ? `${this.cfg.host}:${this.cfg.port}` : '(not set)',
        database: this.cfg.database || '(not set)',
        poolMin: this.cfg.poolMin,
        poolMax: this.cfg.poolMax,
        encrypt: this.cfg.encrypt,
      },
      pool: null,
      server: null,
      error: null,
      checkedAt: new Date().toISOString(),
    };

    if (this.cfg.disabled) {
      diag.error = { message: 'MOTC_SMS_DB_DISABLED=true — MOTC SMS DB pool not created.' };
      return diag;
    }
    if (!this.pool) {
      diag.error = {
        message: 'MOTC SMS DB host/database/user missing — pool not initialized.',
      };
      return diag;
    }

    const start = Date.now();
    try {
      const result = await this.pool.request().query<{ version: string; dbTime: Date }>(
        'SELECT @@VERSION AS version, SYSDATETIMEOFFSET() AS dbTime',
      );
      diag.latencyMs = Date.now() - start;
      diag.connected = true;
      const row = result.recordset[0];
      diag.server = {
        version: String(row?.version ?? 'unknown').split('\n')[0].trim(),
        dbTime: String(row?.dbTime ?? 'unknown'),
      };
      diag.pool = {
        size: this.pool.size,
        available: this.pool.available,
        borrowed: this.pool.borrowed,
        pending: this.pool.pending,
      };
      this.logger.log(`MOTC SMS DB diagnose OK (${diag.latencyMs}ms)`);
    } catch (err) {
      diag.latencyMs = Date.now() - start;
      const wrapped = MssqlQueryError.from(err);
      diag.error = { message: wrapped.message, code: (err as { code?: string }).code };
      this.logger.error(
        `MOTC SMS DB diagnose FAILED after ${diag.latencyMs}ms: ${wrapped.message}`,
      );
    }
    return diag;
  }

  /** Loggable `{ k=v, ... }` with secrets redacted. */
  private formatParams(params: Record<string, unknown>): string {
    const keys = Object.keys(params);
    if (keys.length === 0) return '{}';
    const parts = keys.map((k) =>
      MotcSmsDbService.SENSITIVE_PARAM.test(k) ? `${k}=***` : `${k}=${String(params[k])}`,
    );
    return `{ ${parts.join(', ')} }`;
  }
}
