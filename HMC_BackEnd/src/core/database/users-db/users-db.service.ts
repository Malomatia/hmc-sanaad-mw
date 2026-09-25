import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { USERS_DB_DRIVERS, UsersDbConfig, UsersDbDriver } from '../../config/configuration';
import { SqlQueryError, SqlUnavailableException } from '../sql.error';

/** SQL dialect of the connected Users DB — repositories pick their statements by it. */
export type UsersDbDialect = UsersDbDriver;

/** Current server time, the one expression most statements differ by. */
export const SQL_NOW: Record<UsersDbDialect, string> = { mssql: 'GETDATE()', mysql: 'NOW()' };

/** Result of a data-modifying statement. */
export interface UsersDbExecuteResult<T = Record<string, any>> {
  rowsAffected: number;
  /** Rows returned by an OUTPUT clause (SQL Server), when present. */
  rows: T[];
  /** MySQL `insertId` (AUTO_INCREMENT, or the value set via LAST_INSERT_ID(expr)). */
  insertId?: number;
}

/** Connectivity probe report for /health/users-db (mirrors OracleDiagnostics). */
export interface UsersDbDiagnostics {
  /** Configured driver; absent for the MOTC SMS DB, which is always SQL Server. */
  driver?: string;
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

/** What a driver hands back for one statement. */
export interface UsersDbRawResult {
  rows: Record<string, any>[];
  rowsAffected: number;
  insertId?: number;
}

/** The statements available inside `UsersDbService.transaction`. */
export interface UsersDbExecutor {
  query<T = Record<string, any>>(statement: string, params?: Record<string, unknown>): Promise<T[]>;
  execute<T = Record<string, any>>(
    statement: string,
    params?: Record<string, unknown>,
  ): Promise<UsersDbExecuteResult<T>>;
}

/** A driver's open transaction: one connection until commit or rollback. */
export interface UsersDbTransactionHandle {
  run(statement: string, params: Record<string, unknown>): Promise<UsersDbRawResult>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/**
 * MySQL exact (binary, case-sensitive) match that can still use the column's
 * index — the equivalent of SQL Server's `COLLATE Latin1_General_100_BIN2`.
 */
export const mysqlExact = (column: string, bind: string): string =>
  `${column} = ${bind} AND CAST(${column} AS BINARY) = ${bind}`;

/**
 * The Users/Sanaad database — the second database wired into the app (sibling
 * of OracleService). Backs the auth cycle (HMC_Sanad_DeviceRegn_tbl,
 * HMC_RHAP_OTP_tbl), the API-1 healthcheck tables, device tokens, attestation
 * and the audit logs.
 *
 * Abstract so the engine is a deployment choice: USERS_DB_DRIVER picks
 * `MssqlUsersDbService` (default) or `MysqlUsersDbService`, and this class is
 * also the DI token every consumer injects. Everything that is not
 * driver-specific lives here.
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
 * `@params`, never string interpolation, whichever the driver.
 */
export abstract class UsersDbService implements OnModuleInit, OnModuleDestroy {
  protected readonly logger = new Logger(UsersDbService.name);
  protected readonly cfg: UsersDbConfig;
  abstract readonly dialect: UsersDbDialect;
  /** In-flight creation attempt — shared so concurrent queries don't stampede. */
  private creating: Promise<void> | undefined;
  /** Monotonic counter so each call's log lines can be correlated. */
  private callSeq = 0;

  /** Param keys whose values must never be logged. */
  private static readonly SENSITIVE_PARAM = /(mpin|password|pwd|otp|secret|token)/i;

  constructor(config: ConfigService) {
    this.cfg = config.getOrThrow<UsersDbConfig>('usersDb');
  }

  /** Create the pool and prove one connection works; throw on failure. */
  protected abstract connect(): Promise<void>;
  protected abstract hasPool(): boolean;
  protected abstract closePool(): Promise<void>;
  /** Run one parameterized statement; `@name` binds as the callers wrote them. */
  protected abstract rawQuery(
    statement: string,
    params: Record<string, unknown>,
  ): Promise<UsersDbRawResult>;
  /** Server version + current time, for the boot probe and /health/users-db. */
  protected abstract probe(): Promise<{ version: string; dbTime: string }>;
  protected abstract poolStats(): UsersDbDiagnostics['pool'];
  /** Take a connection from the pool and open a transaction on it. */
  protected abstract begin(): Promise<UsersDbTransactionHandle>;

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
    if (!USERS_DB_DRIVERS.includes(this.cfg.driver as UsersDbDriver)) {
      missing.push(`USERS_DB_DRIVER (got "${this.cfg.driver}", use ${USERS_DB_DRIVERS.join(' or ')})`);
    }
    if (!this.cfg.host) missing.push('USERS_DB_HOST');
    if (!this.cfg.database) missing.push('USERS_DB_NAME');
    if (!this.cfg.user) missing.push('USERS_DB_USER');
    return missing;
  }

  /**
   * The pool, created on demand. Throws SqlUnavailableException (→ 503)
   * with the precise reason when it cannot be.
   */
  private async ensurePool(): Promise<void> {
    if (this.hasPool()) return;
    if (this.creating) return this.creating;

    const missing = this.missingConfig();
    if (missing.length) {
      throw new SqlUnavailableException(
        `The users database is not configured — set ${missing.join(', ')} in the environment.`,
      );
    }

    this.creating = this.createPool();
    try {
      await this.creating;
    } finally {
      this.creating = undefined;
    }
  }

  private async createPool(): Promise<void> {
    try {
      await this.connect();
      this.logger.log(
        `Users DB pool created (${this.dialect}, min=${this.cfg.poolMin}, max=${this.cfg.poolMax}) → ${this.cfg.host}:${this.cfg.port}/${this.cfg.database}`,
      );
      await this.verifyConnectivity();
    } catch (err) {
      // The driver's message alone ("connect ETIMEDOUT") does not say where it
      // tried to go; the effective target is what a deployment gets wrong.
      // Server log only — the HTTP error must not reveal internal addresses.
      this.logger.error(
        `Failed to create Users DB pool (${this.dialect} → ${this.cfg.host}:${this.cfg.port}/${this.cfg.database}, ` +
          `encrypt=${this.cfg.encrypt}, connectTimeout=${this.cfg.connectTimeoutMs}ms): ${(err as Error).message}`,
      );
      throw new SqlUnavailableException(
        `The users database is currently unavailable: ${(err as Error).message}`,
      );
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
      const { dbTime } = await this.probe();
      this.logger.log(
        `Users DB connectivity verified in ${Date.now() - started}ms (server time: ${dbTime})`,
      );
    } catch (err) {
      this.logger.error(
        `Users DB pool connected but probe query FAILED — auth-cycle calls will fail: ${(err as Error).message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.hasPool()) {
      await this.closePool();
      this.logger.log('Users DB pool closed.');
    }
  }

  /** A usable pool exists. Callers gate real queries on this. */
  isEnabled(): boolean {
    return this.hasPool();
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
    return (await this.run(statement, params)).rows as T[];
  }

  /** Parameterized INSERT/UPDATE/DELETE — rows affected (+ OUTPUT rows / insertId). */
  async execute<T = Record<string, any>>(
    statement: string,
    params: Record<string, unknown> = {},
  ): Promise<UsersDbExecuteResult<T>> {
    return UsersDbService.toExecuteResult<T>(await this.run(statement, params));
  }

  /**
   * Run `work` in one transaction on one connection: committed when it
   * resolves, rolled back when it throws. For multi-statement units that SQL
   * Server can send as one batch but MySQL cannot (its prepared statements are
   * single-statement, and multi-statement queries stay disabled on purpose).
   */
  async transaction<T>(work: (tx: UsersDbExecutor) => Promise<T>): Promise<T> {
    await this.ensurePool();
    let handle: UsersDbTransactionHandle;
    try {
      handle = await this.begin();
    } catch (err) {
      throw SqlQueryError.from(err);
    }
    const tx: UsersDbExecutor = {
      query: async <R>(statement: string, params: Record<string, unknown> = {}) =>
        (await this.run(statement, params, handle)).rows as R[],
      execute: async <R>(statement: string, params: Record<string, unknown> = {}) =>
        UsersDbService.toExecuteResult<R>(await this.run(statement, params, handle)),
    };
    try {
      const result = await work(tx);
      await handle.commit();
      return result;
    } catch (err) {
      // Statement failures already arrive as SqlQueryError (see run()).
      await handle.rollback().catch(() => undefined);
      throw err;
    }
  }

  private static toExecuteResult<T>(result: UsersDbRawResult): UsersDbExecuteResult<T> {
    return {
      rowsAffected: result.rowsAffected,
      rows: result.rows as T[],
      ...(result.insertId ? { insertId: result.insertId } : {}),
    };
  }

  private async run(
    statement: string,
    params: Record<string, unknown>,
    via?: UsersDbTransactionHandle,
  ): Promise<UsersDbRawResult> {
    const id = ++this.callSeq;
    const started = Date.now();
    const label = this.describeSql(statement);
    this.logger.log(`[usersdb#${id}] → ${label} params=${this.formatParams(params)}`);
    await this.ensurePool();
    try {
      const result = via ? await via.run(statement, params) : await this.rawQuery(statement, params);
      this.logger.log(
        `[usersdb#${id}] done ${label} ${result.rows.length} row(s), ${result.rowsAffected} affected (${Date.now() - started}ms)`,
      );
      return result;
    } catch (err) {
      const wrapped = SqlQueryError.from(err);
      this.logger.error(
        `[usersdb#${id}] FAILED ${label} after ${Date.now() - started}ms: ${wrapped.message}`,
      );
      throw wrapped;
    }
  }

  /** Short label for a statement: the table read or written. */
  private describeSql(statement: string): string {
    const compact = statement.replace(/\s+/g, ' ').trim();
    const target =
      /\bfrom\s+([a-z0-9_$.\[\]`]+)/i.exec(compact) ??
      /\b(?:update|insert\s+into|delete\s+from)\s+([a-z0-9_$.\[\]`]+)/i.exec(compact);
    if (target) return target[1].toUpperCase();
    return compact.length > 60 ? `${compact.slice(0, 57)}...` : compact;
  }

  /** Lightweight readiness check for the /health endpoint (creates the pool on demand). */
  async ping(): Promise<boolean> {
    try {
      await this.ensurePool();
      await this.rawQuery('SELECT 1 AS ok', {});
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
  async diagnose(): Promise<UsersDbDiagnostics> {
    const diag: UsersDbDiagnostics = {
      driver: this.cfg.driver,
      enabled: this.hasPool(),
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
    try {
      await this.ensurePool();
      diag.enabled = true;
    } catch (err) {
      diag.error = { message: (err as Error).message };
      return diag;
    }

    const start = Date.now();
    try {
      diag.server = await this.probe();
      diag.latencyMs = Date.now() - start;
      diag.connected = true;
      diag.pool = this.poolStats();
      this.logger.log(`Users DB diagnose OK (${diag.latencyMs}ms)`);
    } catch (err) {
      diag.latencyMs = Date.now() - start;
      const wrapped = SqlQueryError.from(err);
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
      UsersDbService.SENSITIVE_PARAM.test(k) ? `${k}=***` : `${k}=${String(params[k])}`,
    );
    return `{ ${parts.join(', ')} }`;
  }
}
