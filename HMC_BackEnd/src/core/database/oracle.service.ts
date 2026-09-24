import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import oracledb = require('oracledb');
import { OracleConfig } from '../config/configuration';
import { ERROR_MESSAGES, extractOraCode } from '@shared/constants/error-codes';
import { OracleQueryError, OracleUnavailableException } from './oracle.error';

import { normalizeOracleUsernameBinds } from './oracle-username.util';

/** Rich result of a connectivity probe used by the DB health-test endpoint. */
export interface OracleDiagnostics {
  /** Pool was successfully created at startup. */
  enabled: boolean;
  /** A live connection was obtained and a test query executed. */
  connected: boolean;
  /** Round-trip time (ms) for acquiring a connection + running the probe. */
  latencyMs: number | null;
  connection: { user: string; dsn: string; poolMin: number; poolMax: number };
  pool: { connectionsOpen: number; connectionsInUse: number } | null;
  server: { version: string; dbTime: string } | null;
  error: { message: string; oraCode?: number } | null;
  checkedAt: string;
}

/** Per-call context threaded through the start/success/error log lines. */

/**
 * Single `node-oracledb` connection pool for the whole app. Runs in Thick mode
 * (Oracle Client libraries) when `ORACLE_THICK_MODE` is enabled, otherwise the
 * built-in Thin driver.
 * Exposes low-level primitives:
 *  - `query`   → parameterized SELECT against views/LOVs (Pattern A)
 *  - `call`    → anonymous PL/SQL block for `_PR`/`_PKG` with OUT binds (Pattern B/C)
 *  - `callCursor` → PL/SQL returning a REF CURSOR read into an array
 *
 * See Docs_Ai/Repository Pattern/README.md.
 */
@Injectable()
export class OracleService implements OnModuleInit, OnModuleDestroy {
  private pool: oracledb.Pool | undefined;
  private brokenPool: oracledb.Pool | undefined;
  private creating: Promise<oracledb.Pool> | undefined;
  private retryAfter = 0;
  private stopping = false;
  private lastPoolError: unknown;
  private readonly connectionPools = new WeakMap<oracledb.Connection, oracledb.Pool>();
  private readonly retiredPools = new Set<oracledb.Pool>();
  private readonly closingPools = new Map<oracledb.Pool, Promise<void>>();
  private static readonly POOL_CREATE_ATTEMPTS = 2;
  private static readonly POOL_RETRY_DELAY_MS = 1000;
  private static readonly POOL_RETRY_COOLDOWN_MS = 2000;
  private readonly cfg: OracleConfig;
  /** Monotonic counter so each Oracle call's log lines can be correlated. */

  /** Bind/column keys whose values must never be logged. */

  constructor(config: ConfigService) {
    this.cfg = config.getOrThrow<OracleConfig>('oracle');
  }

  async onModuleInit(): Promise<void> {
    if (this.cfg.disabled) {
      return;
    }
    if (!this.cfg.user || !this.cfg.dsn) {
      return;
    }
    try {
      await this.getPool();
    } catch (err) {
      // Deliberately NOT rethrown. Rethrowing here aborts the Nest bootstrap,
      // so one bad DSN or password took the entire API down — including the
      // auth journey, which does not touch Oracle at all (2026-08-30 outage:
      // the host answered a bare HTML 503 because no process was listening).
      // Note the asymmetry this removes: missing credentials already degraded
      // gracefully above, while *wrong* ones killed the process.
      // Without a pool the degraded path is already complete: getPool() raises
      // OracleUnavailableException (clean per-request 503) and /health reports
      // oracle.reachable = false, which also makes the cause obvious.
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    await this.creating?.catch(() => undefined);
    const pool = this.pool;
    this.pool = undefined;
    this.brokenPool = undefined;
    if (pool) {
      await this.closePool(pool);
    }
    await Promise.all([...this.retiredPools].map((retired) => this.closePool(retired)));
  }

  private async createPool(): Promise<oracledb.Pool> {
    this.enableThickModeIfConfigured();
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
    oracledb.fetchAsString = [oracledb.CLOB];
    // BLOBs otherwise arrive as Lob STREAMS, not Buffers. The attachment
    // reader tested `Buffer.isBuffer(...)` and silently returned an empty
    // string for every file, so downloads had never once worked. Buffering
    // is appropriate here: the only BLOBs read are request attachments, and
    // uploads are already capped at the 15 MB body limit.
    oracledb.fetchAsBuffer = [oracledb.BLOB];
    return oracledb.createPool({
      user: this.cfg.user,
      password: this.cfg.password,
      connectString: this.cfg.dsn,
      poolMin: this.cfg.poolMin,
      poolMax: this.cfg.poolMax,
      poolTimeout: this.cfg.poolTimeout,
      queueTimeout: this.cfg.queueTimeout,
    });
  }

  private closePool(pool: oracledb.Pool, drainSeconds = 5): Promise<void> {
    const active = this.closingPools.get(pool);
    if (active) return active;
    this.retiredPools.add(pool);
    const closing = pool
      .close(drainSeconds)
      .then(
        () => {
          this.retiredPools.delete(pool);
        },
        (err: Error) => {
          if (/\bNJS-065\b/.test(err.message)) this.retiredPools.delete(pool);
        },
      )
      .finally(() => {
        this.closingPools.delete(pool);
      });
    this.closingPools.set(pool, closing);
    return closing;
  }

  private async recoverPool(oldPool?: oracledb.Pool): Promise<oracledb.Pool> {
    this.pool = undefined;
    this.brokenPool = undefined;
    if (oldPool) this.retiredPools.add(oldPool);
    const drainSeconds = Math.max(5, Math.ceil(((this.cfg.callTimeout ?? 25000) * 2) / 1000));
    for (const retired of this.retiredPools) void this.closePool(retired, drainSeconds);
    for (let attempt = 1; attempt <= OracleService.POOL_CREATE_ATTEMPTS; attempt++) {
      if (this.stopping) break;
      let candidate: oracledb.Pool | undefined;
      try {
        candidate = await this.createPool();
        if (this.stopping) throw this.poolUnavailable();
        const conn = await this.connect(candidate);
        try {
          await conn.ping();
        } finally {
          await conn.close();
        }
        if (this.stopping) throw this.poolUnavailable();
        this.pool = candidate;
        this.retryAfter = 0;
        this.lastPoolError = undefined;

        return candidate;
      } catch (err) {
        this.lastPoolError = err;
        if (candidate) await this.closePool(candidate);
        if (this.stopping) break;

        if (attempt < OracleService.POOL_CREATE_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, OracleService.POOL_RETRY_DELAY_MS));
        }
      }
    }
    this.retryAfter = Date.now() + OracleService.POOL_RETRY_COOLDOWN_MS;
    throw this.poolUnavailable();
  }

  private poolUnavailable(cause = this.lastPoolError): OracleUnavailableException {
    return new OracleUnavailableException(ERROR_MESSAGES.ORACLE_UNAVAILABLE, { cause });
  }

  private isConnectionFailure(err: unknown): boolean {
    const error = err as { code?: string; message?: string; errorNum?: number } | undefined;
    const code = error?.code ?? error?.message?.match(/\b(?:ORA|NJS|DPI)-\d+\b/)?.[0];
    const oraCode =
      error?.errorNum ?? (code?.startsWith('ORA-') ? Number(code.slice(4)) : undefined);
    return (
      /^(?:NJS-(?:002|003|064|065|500|501|503|510|511|518|521)|DPI-(?:1010|1080)|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT)$/.test(
        code ?? '',
      ) ||
      [
        28, 1012, 1033, 1034, 1089, 1090, 1092, 3113, 3114, 3135, 12170, 12514, 12537, 12541, 12543,
        12545, 12547, 12570, 12571,
      ].includes(oraCode ?? 0)
    );
  }

  private markBroken(conn: oracledb.Connection | undefined, err: unknown): void {
    if (conn) this.markPoolBroken(this.connectionPools.get(conn), err);
  }

  private markPoolBroken(pool: oracledb.Pool | undefined, err: unknown, cooldown = false): void {
    if (!pool || pool !== this.pool || !this.isConnectionFailure(err)) return;
    this.brokenPool = pool;
    this.lastPoolError = err;
    if (cooldown) this.retryAfter = Date.now() + OracleService.POOL_RETRY_COOLDOWN_MS;
  }

  private async connect(pool: oracledb.Pool, callTimeoutMs?: number): Promise<oracledb.Connection> {
    const conn = await pool.getConnection();
    try {
      this.configureConnection(conn);
      if (callTimeoutMs !== undefined) conn.callTimeout = callTimeoutMs;
      if (this.stopping) throw this.poolUnavailable();
      this.connectionPools.set(conn, pool);
      return conn;
    } catch (err) {
      await this.safeClose(conn);
      throw err;
    }
  }

  /**
   * Enable node-oracledb Thick mode by loading the Oracle Client libraries.
   * Must run before any pool/connection is created. Idempotent: skips if Thick
   * mode is already active (initOracleClient can only be called once).
   */
  private enableThickModeIfConfigured(): void {
    if (!this.cfg.thickMode) {
      return;
    }
    if (!oracledb.thin) {
      // Client already initialized (e.g. a previous pool in the same process).
      return;
    }
    try {
      oracledb.initOracleClient(this.cfg.libDir ? { libDir: this.cfg.libDir } : undefined);
    } catch (err) {
      throw err;
    }
  }

  /** A usable pool exists. Callers gate real queries on this. */
  isEnabled(): boolean {
    return this.pool !== undefined;
  }

  /**
   * We were CONFIGURED to use Oracle, whether or not the pool came up.
   *
   * Kept separate from isEnabled() so /health can tell "switched off on
   * purpose" apart from "configured but broken" — both used to report
   * enabled:false, reachable:false, which is why the 2026-08-30 outage was
   * diagnosed from the outside instead of from /health.
   */
  isConfigured(): boolean {
    return !this.cfg.disabled && Boolean(this.cfg.user) && Boolean(this.cfg.dsn);
  }

  private async getPool(): Promise<oracledb.Pool> {
    if (this.stopping || this.cfg.disabled) throw this.poolUnavailable();
    if (this.creating) return this.creating;
    if (this.pool && this.pool !== this.brokenPool) return this.pool;
    if (!this.isConfigured() || Date.now() < this.retryAfter) throw this.poolUnavailable();
    this.creating = this.recoverPool(this.pool).finally(() => {
      this.creating = undefined;
    });
    return this.creating;
  }

  /**
   * Acquire a raw pooled connection for internal tooling that must run
   * arbitrary statements outside the query/call helpers (the developer
   * console). The caller owns closing it. Not used by feature modules —
   * repositories always go through `query`/`call`/`callCursor` so every
   * application statement stays logged and shaped.
   */
  async acquire(callTimeoutMs?: number): Promise<oracledb.Connection> {
    const existing = this.pool !== this.brokenPool ? this.pool : undefined;
    let pool = await this.getPool();
    try {
      return await this.connect(pool, callTimeoutMs);
    } catch (err) {
      if (!this.isConnectionFailure(err)) throw this.poolUnavailable(err);
      this.markPoolBroken(pool, err, pool !== existing);
      if (pool !== existing) throw this.poolUnavailable(err);
      pool = await this.getPool();
      try {
        return await this.connect(pool, callTimeoutMs);
      } catch (retryError) {
        this.markPoolBroken(pool, retryError, true);
        throw this.poolUnavailable(retryError);
      }
    }
  }

  /** Parameterized SELECT — returns mapped rows (object format). */
  async query<T = Record<string, any>>(
    sql: string,
    binds: oracledb.BindParameters = {},
  ): Promise<T[]> {
    const normalizedBinds = normalizeOracleUsernameBinds(binds);

    let conn: oracledb.Connection | undefined;
    try {
      conn = await this.acquire();
      const result = await conn.execute<T>(sql, normalizedBinds, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      });
      const rows = (result.rows as T[]) ?? [];

      return rows;
    } catch (err) {
      throw this.mapError(err, conn);
    } finally {
      if (conn) await this.safeClose(conn);
    }
  }

  /**
   * Clear the EBS session labels this connection may still carry from a
   * previous call, BEFORE running a submit procedure.
   *
   * Why: every `XXHMC_SND_*` submit procedure starts with a "log the user out
   * of SSHR" block:
   *
   *     FOR r IN (SELECT s.sid, s.serial# FROM v$session s
   *                WHERE client_identifier = p_user_name
   *                  AND action IN ('PER/XX_HMC_SSHR_EMP_SELF_SERVICE', ...))
   *     LOOP EXECUTE IMMEDIATE 'ALTER SYSTEM KILL SESSION ...'; END LOOP;
   *
   * A procedure that ran earlier on the same POOLED connection called
   * `fnd_global.apps_initialize`, which stamps `client_identifier` = the
   * username and `action` = one of those SSHR values onto our session. The
   * next procedure's loop then matches OUR OWN session and Oracle raises
   * `ORA-00027: cannot kill current session`, aborting real work (observed on
   * SCHOOL_FEE_PR line 114, LEAV_OF_ABSEN_NEW_PR line 168 and
   * ADD_DEPENDENT_PKG line 3506, seemingly at random — it depends on which
   * pooled connection the request lands on).
   *
   * Verified on staging: `v$session` showed our own connection
   * (`program = node@…`) with `client_identifier = AIBRAHIM39` and
   * `action = PER/XX_HMC_SSHR_EMP_SELF_SERVICE`.
   *
   * Clearing the labels makes that loop skip us. It does not affect the
   * procedures themselves: they re-initialize the EBS context (apps_initialize)
   * after that block and read the user from their own `p_user_name` argument.
   * Best-effort — a failure here must never fail the business call.
   */
  private async clearEbsSessionLabels(conn: oracledb.Connection): Promise<void> {
    try {
      await conn.execute(
        `BEGIN
           DBMS_APPLICATION_INFO.SET_ACTION(NULL);
           DBMS_APPLICATION_INFO.SET_MODULE(NULL, NULL);
           DBMS_SESSION.CLEAR_IDENTIFIER;
         END;`,
      );
    } catch (err) {}
  }

  /** Execute an anonymous PL/SQL block; returns the OUT binds. */
  async call<T = Record<string, any>>(
    plsql: string,
    binds: oracledb.BindParameters,
    options: oracledb.ExecuteOptions = {},
  ): Promise<T> {
    const normalizedBinds = normalizeOracleUsernameBinds(binds);

    let conn: oracledb.Connection | undefined;
    try {
      conn = await this.acquire();
      await this.clearEbsSessionLabels(conn);
      const result = await conn.execute(plsql, normalizedBinds, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        autoCommit: true,
        ...options,
      });
      const outBinds = (result.outBinds as T) ?? ({} as T);

      return outBinds;
    } catch (err) {
      throw this.mapError(err, conn);
    } finally {
      if (conn) await this.safeClose(conn);
    }
  }

  /**
   * Execute a PL/SQL block returning a REF CURSOR bound as `cursorBindName`
   * (default `:cursor`). Reads all rows then closes the cursor.
   */
  async callCursor<T = Record<string, any>>(
    plsql: string,
    binds: oracledb.BindParameters,
    cursorBindName = 'cursor',
  ): Promise<T[]> {
    const normalizedBinds = normalizeOracleUsernameBinds(binds);

    let conn: oracledb.Connection | undefined;
    try {
      conn = await this.acquire();
      await this.clearEbsSessionLabels(conn);
      const result = await conn.execute(plsql, normalizedBinds, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        autoCommit: true,
      });
      const outBinds = (result.outBinds ?? {}) as Record<string, oracledb.ResultSet<T>>;
      const cursor = outBinds[cursorBindName];
      if (!cursor) {
        return [];
      }
      const rows = (await cursor.getRows(0)) as T[];
      await cursor.close();

      return rows ?? [];
    } catch (err) {
      throw this.mapError(err, conn);
    } finally {
      if (conn) await this.safeClose(conn);
    }
  }

  /**
   * Execute a PL/SQL block returning MULTIPLE REF CURSORs (e.g. PAYSLIP_PR's 7
   * cursors) plus optional scalar OUT binds, in one round trip.
   *
   * A REF CURSOR OUT bind is a `ResultSet` tied to the connection it was
   * opened on. `call()` returns the raw OUT binds (including unread
   * ResultSets) and releases the connection in its `finally` — fetching from
   * one of those ResultSets afterward throws `NJS-018: invalid ResultSet`,
   * because the connection is already back in the pool. Every cursor must be
   * read (and closed) here, before this method's own `finally` releases the
   * connection — the same reason `callCursor` above fetches before closing.
   */
  async callMultiCursor(
    plsql: string,
    binds: oracledb.BindParameters,
    cursorBindNames: readonly string[],
  ): Promise<{ cursors: Record<string, Record<string, any>[]>; scalars: Record<string, any> }> {
    const normalizedBinds = normalizeOracleUsernameBinds(binds);

    let conn: oracledb.Connection | undefined;
    try {
      conn = await this.acquire();
      await this.clearEbsSessionLabels(conn);
      const result = await conn.execute(plsql, normalizedBinds, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        autoCommit: true,
      });
      const outBinds = (result.outBinds ?? {}) as Record<string, unknown>;
      const cursorSet = new Set(cursorBindNames);
      const cursors: Record<string, Record<string, any>[]> = {};
      const scalars: Record<string, any> = {};
      for (const [key, value] of Object.entries(outBinds)) {
        if (cursorSet.has(key)) {
          cursors[key] = await this.readCursorTolerantly(
            key,
            value as oracledb.ResultSet<Record<string, any>> | undefined,
          );
        } else {
          scalars[key] = value;
        }
      }

      return { cursors, scalars };
    } catch (err) {
      throw this.mapError(err, conn);
    } finally {
      if (conn) await this.safeClose(conn);
    }
  }

  /**
   * Read one REF CURSOR OUT bind, treating an UNOPENED cursor as "no rows".
   *
   * A PL/SQL procedure that returns several cursors does not necessarily OPEN
   * all of them: XXHMC_SND_PAYSLIP_PR leaves every cursor unopened when the
   * person/period combination has no payroll data, and the driver then answers
   * `NJS-107: invalid cursor` / `ORA-24338: statement handle not executed` the
   * moment we fetch. That turned "this employee has no payslip for that
   * period" into a hard HTTP 500, even though the procedure itself succeeded
   * and reported through `p_success_flag`.
   *
   * An unopened cursor is a legitimate empty section, so it degrades to `[]`
   * (logged at debug) and the OUT flags carry the real outcome. Any other
   * fetch error still propagates.
   */
  private async readCursorTolerantly(
    name: string,
    cursor: oracledb.ResultSet<Record<string, any>> | undefined,
  ): Promise<Record<string, any>[]> {
    if (!cursor) return [];
    try {
      const rows = (await cursor.getRows(0)) ?? [];
      await cursor.close().catch(() => undefined);
      return rows;
    } catch (err) {
      const message = (err as Error).message ?? '';
      if (/NJS-107|ORA-24338/.test(message)) {
        return [];
      }
      throw err;
    }
  }

  // ── Oracle call logging ─────────────────────────────────────
  // Every Oracle function call is logged (start + outcome) so failing/hanging
  // calls can be traced to the exact object and (sanitized) binds. Correlated
  // by a per-call id `[ora#N]`.

  private mapError(
    err: unknown,
    conn?: oracledb.Connection,
  ): OracleQueryError | OracleUnavailableException {
    this.markBroken(conn, err);
    if (err instanceof OracleUnavailableException) return err;
    return this.isConnectionFailure(err) ? this.poolUnavailable(err) : OracleQueryError.from(err);
  }

  /** Persist a structured record to the in-memory store served by the diagnostics API. */

  /**
   * Substitute each `:bind` in the SQL with its (sanitized) value so the log
   * shows the statement as Oracle effectively receives it. Names are replaced
   * longest-first and only when not followed by another identifier char, so
   * `:p_attachment1` never clobbers `:p_attachment10`. Values are rendered by
   * `toSqlLiteral` (strings single-quoted, NULL/OUT markers preserved). This is
   * a readability aid built from redacted binds — not the literal wire text.
   */

  /** Render a sanitized bind value as an Oracle literal for `buildFinalSql`. */

  /**
   * Capture what Oracle returned (rows or OUT-bind values) for the diagnostics
   * log AS-IS: no column redaction, no string truncation, no row caps — the
   * stored response is exactly the data Oracle produced (explicit requirement:
   * the Oracle-logs endpoint must show the full response untouched).
   *
   * The only transformations are structural, to keep the value storable and
   * JSON-serializable — none of them drop business data:
   *  - A REF CURSOR OUT bind is a live `node-oracledb` `ResultSet`, not plain
   *    data — its `_connection`/`_pool` internals hold circular references
   *    (cursor → connection → pool → ...). Walking those with
   *    `Object.entries`/recursion previously ran away into
   *    `RangeError: Maximum call stack size exceeded`, which — thrown from
   *    *inside* the same try block as the successful `conn.execute()` — masked
   *    an otherwise-successful Oracle call as a generic 500. Only plain object
   *    literals and arrays are walked; anything else (ResultSet, LOB,
   *    Connection, Pool, ...) is described by its constructor name (the call
   *    sites read cursors into plain rows BEFORE recording, so real data is
   *    never behind these driver objects).
   *  - Cycles are broken with a `[circular]` marker (second line of defense).
   *  - Buffers (BLOB values) are described by size — raw binary is not
   *    representable in the JSON log; Dates are ISO strings.
   */

  /** Short label for a statement: the view/table read or the procedure invoked. */

  /** Produce a loggable, safe key→value map: OUT binds as `<OUT>`, secrets redacted. */

  /** Render a sanitized bind map as `{ k=v, ... }` for the console line. */

  /** Lightweight readiness check for the /health endpoint. */
  async ping(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    let conn: oracledb.Connection | undefined;
    try {
      conn = await this.acquire();
      await conn.execute('SELECT 1 FROM DUAL');
      return true;
    } catch (err) {
      this.markBroken(conn, err);
      return false;
    } finally {
      if (conn) await this.safeClose(conn);
    }
  }

  /**
   * Full connectivity probe for the DB health-test endpoint. Never throws:
   * failures are captured in `error` (with the ORA code when available) so the
   * caller can report exactly why the database is unreachable.
   */
  async diagnose(): Promise<OracleDiagnostics> {
    const diag: OracleDiagnostics = {
      enabled: this.pool !== undefined,
      connected: false,
      latencyMs: null,
      connection: {
        user: this.cfg.user || '(not set)',
        dsn: this.cfg.dsn || '(not set)',
        poolMin: this.cfg.poolMin,
        poolMax: this.cfg.poolMax,
      },
      pool: null,
      server: null,
      error: null,
      checkedAt: new Date().toISOString(),
    };

    if (this.cfg.disabled) {
      diag.error = { message: 'ORACLE_DISABLED=true — connection pool not created.' };
      return diag;
    }
    if (!this.isConfigured()) {
      diag.error = { message: 'Oracle credentials/DSN missing — pool not initialized.' };
      return diag;
    }

    const start = Date.now();
    let conn: oracledb.Connection | undefined;
    try {
      conn = await this.acquire();
      const result = await conn.execute<{ DB_TIME: string }>(
        'SELECT TO_CHAR(SYSTIMESTAMP, \'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM\') AS DB_TIME FROM DUAL',
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      diag.latencyMs = Date.now() - start;
      diag.connected = true;
      diag.server = {
        version: conn.oracleServerVersionString,
        dbTime: result.rows?.[0]?.DB_TIME ?? '',
      };
    } catch (err) {
      this.markBroken(conn, err);
      diag.latencyMs = Date.now() - start;
      const cause = err instanceof OracleUnavailableException ? (err.cause ?? err) : err;
      const message = cause instanceof Error ? cause.message : String(cause);
      diag.error = { message, oraCode: extractOraCode(message) };
    } finally {
      if (conn) await this.safeClose(conn);
      diag.enabled = this.isEnabled();
      diag.pool = this.pool
        ? {
            connectionsOpen: this.pool.connectionsOpen,
            connectionsInUse: this.pool.connectionsInUse,
          }
        : null;
    }
    return diag;
  }

  private configureConnection(conn: oracledb.Connection): void {
    conn.callTimeout = this.cfg.callTimeout;
  }

  private async safeClose(conn: oracledb.Connection): Promise<void> {
    try {
      await conn.close();
    } catch (err) {}
  }
}
