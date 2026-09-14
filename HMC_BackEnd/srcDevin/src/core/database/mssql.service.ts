import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sql from 'mssql';
import { UsersDbConfig } from '../config/configuration';
import { MssqlQueryError, MssqlUnavailableException } from './mssql.error';

/** Result of a data-modifying statement. */
export interface MssqlExecuteResult<T = Record<string, any>> {
  rowsAffected: number;
  /** Rows returned by an OUTPUT clause, when present. */
  rows: T[];
}

/** Connectivity probe report for /health/users-db (mirrors OracleDiagnostics). */
export interface MssqlDiagnostics {
  enabled: boolean;
  connected: boolean;
  latencyMs: number | null;
  connection: {
    user: string;
    server: string;
    database: string;
    poolMin: number;
    poolMax: number;
    encrypt: boolean;
  };
  pool: { size: number; available: number; borrowed: number; pending: number } | null;
  server: { version: string; dbTime: string } | null;
  error: { message: string; code?: string } | null;
  checkedAt: string;
}

/**
 * Single `mssql` connection pool for the Users/Sanaad SQL Server database —
 * the second database wired into the app (sibling of OracleService). Backs
 * the auth cycle (HMC_Sanad_DeviceRegn_tbl, HMC_RHAP_OTP_tbl) and the API-1
 * healthcheck tables (HMC_Sanad_AppDownTime_tbl / HMC_Sanad_App_Update_tbl).
 *
 * Pool lifecycle (client request 2026-08-31): the pool is created DIRECTLY —
 * `USERS_DB_DISABLED` is no longer honored — eagerly at boot and, when that
 * fails or the DB is down, retried lazily on the next query (single-flight,
 * so concurrent requests share one attempt). A boot-time failure never
 * crashes the app; a later successful attempt heals without a restart. The
 * only unrecoverable state is missing configuration, and the error then
 * names the exact env vars.
 *
 * Exposes parameterized primitives only — all values go through named
 * `@params`, never string interpolation.
 */
@Injectable()
export class MssqlService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MssqlService.name);
  private pool: sql.ConnectionPool | undefined;
  /** In-flight creation attempt — shared so concurrent queries don't stampede. */
  private creating: Promise<sql.ConnectionPool> | undefined;
  private readonly cfg: UsersDbConfig;
  /** Monotonic counter so each call's log lines can be correlated. */
  private callSeq = 0;

  /** Param keys whose values must never be logged. */
  private static readonly SENSITIVE_PARAM = /(mpin|password|pwd|otp|secret|token)/i;

  constructor(config: ConfigService) {
    this.cfg = config.getOrThrow<UsersDbConfig>('usersDb');
  }

  async onModuleInit(): Promise<void> {
    // Eager attempt so the boot log states the pool's fate — but never fatal:
    // a wrong host/password must not take Oracle-backed endpoints down, and
    // ensurePool() retries on first use anyway.
    try {
      await this.ensurePool();
    } catch (err) {
      this.logger.error(
        `Users DB pool not created at boot: ${(err as Error).message} — ` +
          'auth-cycle DB calls will retry the connection on demand.',
      );
    }
  }

  /** USERS_DB_* env vars without which no connection is possible. */
  private missingConfig(): string[] {
    const missing: string[] = [];
    if (!this.cfg.host) missing.push('USERS_DB_HOST');
    if (!this.cfg.database) missing.push('USERS_DB_NAME');
    if (!this.cfg.user) missing.push('USERS_DB_USER');
    return missing;
  }

  /**
   * The pool, created on demand. Throws MssqlUnavailableException (→ 503)
   * with the precise reason when it cannot be.
   */
  private async ensurePool(): Promise<sql.ConnectionPool> {
    if (this.pool) return this.pool;
    if (this.creating) return this.creating;

    const missing = this.missingConfig();
    if (missing.length) {
      throw new MssqlUnavailableException(
        `The users database is not configured — set ${missing.join(', ')} in the environment.`,
      );
    }

    this.creating = new sql.ConnectionPool({
      server: this.cfg.host,
      port: this.cfg.port,
      database: this.cfg.database,
      user: this.cfg.user,
      password: this.cfg.password,
      pool: { min: this.cfg.poolMin, max: this.cfg.poolMax },
      options: {
        encrypt: this.cfg.encrypt,
        trustServerCertificate: this.cfg.trustServerCertificate,
      },
      requestTimeout: this.cfg.requestTimeoutMs,
      connectionTimeout: this.cfg.connectTimeoutMs,
    }).connect();

    try {
      const pool = await this.creating;
      pool.on('error', (err) => this.logger.error(`Users DB pool error: ${err.message}`));
      this.pool = pool;
      this.logger.log(
        `Users DB pool created (min=${this.cfg.poolMin}, max=${this.cfg.poolMax}) → ${this.cfg.host}:${this.cfg.port}/${this.cfg.database}`,
      );
      await this.verifyConnectivity();
      return pool;
    } catch (err) {
      this.logger.error(`Failed to create Users DB pool: ${(err as Error).message}`);
      throw new MssqlUnavailableException(
        `The users database is currently unavailable: ${(err as Error).message}`,
      );
    } finally {
      this.creating = undefined;
    }
  }

  /**
   * Startup probe: run a real query so the boot log states unambiguously
   * whether the Users DB is usable (a pool can connect yet still fail on
   * queries — wrong DB, missing grants). Logs only; never blocks boot.
   */
  private async verifyConnectivity(): Promise<void> {
    try {
      const started = Date.now();
      const result = await this.pool!.request().query<{ dbTime: Date }>(
        'SELECT SYSDATETIMEOFFSET() AS dbTime',
      );
      this.logger.log(
        `Users DB connectivity verified in ${Date.now() - started}ms (server time: ${String(result.recordset[0]?.dbTime ?? 'unknown')})`,
      );
    } catch (err) {
      this.logger.error(
        `Users DB pool connected but probe query FAILED — auth-cycle calls will fail: ${(err as Error).message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.logger.log('Users DB pool closed.');
    }
  }

  /** A usable pool exists. Callers gate real queries on this. */
  isEnabled(): boolean {
    return this.pool !== undefined;
  }

  /** Configured to be used, pool up or not — see OracleService.isConfigured. */
  isConfigured(): boolean {
    return this.missingConfig().length === 0;
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
    this.logger.log(`[mssql#${id}] → ${label} params=${this.formatParams(params)}`);
    const request = (await this.ensurePool()).request();
    for (const [key, value] of Object.entries(params)) {
      request.input(key, value as sql.ISqlType | unknown);
    }
    try {
      const result = await request.query(statement);
      const ms = Date.now() - started;
      const rows = result.recordset?.length ?? 0;
      this.logger.log(
        `[mssql#${id}] done ${label} ${rows} row(s), ${result.rowsAffected} affected (${ms}ms)`,
      );
      return result;
    } catch (err) {
      const ms = Date.now() - started;
      const wrapped = MssqlQueryError.from(err);
      this.logger.error(`[mssql#${id}] FAILED ${label} after ${ms}ms: ${wrapped.message}`);
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

  /** Lightweight readiness check for the /health endpoint (creates the pool on demand). */
  async ping(): Promise<boolean> {
    try {
      await (await this.ensurePool()).request().query('SELECT 1 AS ok');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Full connectivity probe for the /health/users-db endpoint. Never throws:
   * failures are captured in `error` so the caller can report exactly why the
   * database is unreachable. Mirrors OracleService.diagnose.
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

    // Bring the pool up on demand (lazy creation) so /health/users-db reports
    // the REAL blocker: missing env vars or the exact connect error.
    let pool: sql.ConnectionPool;
    try {
      pool = await this.ensurePool();
      diag.enabled = true;
    } catch (err) {
      diag.error = { message: (err as Error).message };
      return diag;
    }

    const start = Date.now();
    try {
      const result = await pool.request().query<{ version: string; dbTime: Date }>(
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
        size: pool.size,
        available: pool.available,
        borrowed: pool.borrowed,
        pending: pool.pending,
      };
      this.logger.log(`Users DB diagnose OK (${diag.latencyMs}ms)`);
    } catch (err) {
      diag.latencyMs = Date.now() - start;
      const wrapped = MssqlQueryError.from(err);
      diag.error = { message: wrapped.message, code: (err as { code?: string }).code };
      this.logger.error(`Users DB diagnose FAILED after ${diag.latencyMs}ms: ${wrapped.message}`);
    }
    return diag;
  }

  /** Loggable `{ k=v, ... }` with secrets redacted. */
  private formatParams(params: Record<string, unknown>): string {
    const keys = Object.keys(params);
    if (keys.length === 0) return '{}';
    const parts = keys.map((k) =>
      MssqlService.SENSITIVE_PARAM.test(k) ? `${k}=***` : `${k}=${String(params[k])}`,
    );
    return `{ ${parts.join(', ')} }`;
  }
}
