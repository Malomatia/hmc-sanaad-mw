import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import oracledb = require('oracledb');
import { OracleConfig } from '../config/configuration';
import { ERROR_MESSAGES, extractOraCode } from '@shared/constants/error-codes';
import { OracleQueryError, OracleUnavailableException } from './oracle.error';
import { RequestContext } from '../http/request-context';
import { OracleLogStore } from './oracle-log.store';

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
interface OracleCallLog {
  id: number;
  op: 'query' | 'call' | 'callCursor';
  label: string;
  started: number;
  sql: string;
  binds: Record<string, string>;
}

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
  private readonly logger = new Logger(OracleService.name);
  private pool: oracledb.Pool | undefined;
  private readonly cfg: OracleConfig;
  /** Monotonic counter so each Oracle call's log lines can be correlated. */
  private callSeq = 0;

  /** Bind/column keys whose values must never be logged. */
  private static readonly SENSITIVE_BIND = /(mpin|password|pwd|otp|secret|token)/i;

  constructor(
    config: ConfigService,
    private readonly logStore: OracleLogStore,
  ) {
    this.cfg = config.getOrThrow<OracleConfig>('oracle');
  }

  async onModuleInit(): Promise<void> {
    if (this.cfg.disabled) {
      this.logger.warn('ORACLE_DISABLED=true — connection pool not created.');
      return;
    }
    if (!this.cfg.user || !this.cfg.dsn) {
      this.logger.warn('Oracle credentials/DSN missing — pool not created. Data calls will fail.');
      return;
    }
    try {
      this.enableThickModeIfConfigured();
      oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
      oracledb.fetchAsString = [oracledb.CLOB];
      // BLOBs otherwise arrive as Lob STREAMS, not Buffers. The attachment
      // reader tested `Buffer.isBuffer(...)` and silently returned an empty
      // string for every file, so downloads had never once worked. Buffering
      // is appropriate here: the only BLOBs read are request attachments, and
      // uploads are already capped at the 15 MB body limit.
      oracledb.fetchAsBuffer = [oracledb.BLOB];
      this.pool = await oracledb.createPool({
        user: this.cfg.user,
        password: this.cfg.password,
        connectString: this.cfg.dsn,
        poolMin: this.cfg.poolMin,
        poolMax: this.cfg.poolMax,
        poolTimeout: this.cfg.poolTimeout,
        queueTimeout: this.cfg.queueTimeout,
      });
      this.logger.log(
        `Oracle pool created (min=${this.cfg.poolMin}, max=${this.cfg.poolMax}) → ${this.cfg.dsn}`,
      );
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
      this.logger.error(
        `Failed to create Oracle pool: ${(err as Error).message} — starting without it; ` +
          'Oracle-backed endpoints will answer 503 until the configuration is fixed.',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.close(5);
      this.logger.log('Oracle pool closed.');
    }
  }

  /**
   * Enable node-oracledb Thick mode by loading the Oracle Client libraries.
   * Must run before any pool/connection is created. Idempotent: skips if Thick
   * mode is already active (initOracleClient can only be called once).
   */
  private enableThickModeIfConfigured(): void {
    if (!this.cfg.thickMode) {
      this.logger.log('Oracle Thin mode (ORACLE_THICK_MODE=false).');
      return;
    }
    if (!oracledb.thin) {
      // Client already initialized (e.g. a previous pool in the same process).
      return;
    }
    try {
      oracledb.initOracleClient(this.cfg.libDir ? { libDir: this.cfg.libDir } : undefined);
      this.logger.log(
        `Oracle Thick mode enabled${this.cfg.libDir ? ` (libDir=${this.cfg.libDir})` : ''}.`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to enable Oracle Thick mode — are the Oracle Client libraries installed` +
          `${this.cfg.libDir ? ` at ${this.cfg.libDir}` : ' and on the library path'}? ` +
          `${(err as Error).message}`,
      );
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

  private getPool(): oracledb.Pool {
    if (!this.pool) {
      throw new OracleUnavailableException(ERROR_MESSAGES.ORACLE_UNAVAILABLE);
    }
    return this.pool;
  }

  /**
   * Acquire a raw pooled connection for internal tooling that must run
   * arbitrary statements outside the query/call helpers (the developer
   * console). The caller owns closing it. Not used by feature modules —
   * repositories always go through `query`/`call`/`callCursor` so every
   * application statement stays logged and shaped.
   */
  async acquire(callTimeoutMs?: number): Promise<oracledb.Connection> {
    const conn = await this.getPool().getConnection();
    conn.callTimeout = callTimeoutMs ?? this.cfg.callTimeout;
    return conn;
  }

  /** Parameterized SELECT — returns mapped rows (object format). */
  async query<T = Record<string, any>>(
    sql: string,
    binds: oracledb.BindParameters = {},
  ): Promise<T[]> {
    const call = this.logCallStart('query', sql, binds);
    const conn = await this.getPool().getConnection();
    this.configureConnection(conn);
    try {
      const result = await conn.execute<T>(sql, binds, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      });
      const rows = (result.rows as T[]) ?? [];
      this.logCallSuccess(call, {
        summary: `${rows.length} row(s)`,
        rowCount: rows.length,
        response: this.captureRawResponse(rows),
      });
      return rows;
    } catch (err) {
      throw this.logCallError(call, err);
    } finally {
      await this.safeClose(conn);
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
    } catch (err) {
      this.logger.debug(`Could not clear EBS session labels: ${(err as Error).message}`);
    }
  }

  /** Execute an anonymous PL/SQL block; returns the OUT binds. */
  async call<T = Record<string, any>>(
    plsql: string,
    binds: oracledb.BindParameters,
    options: oracledb.ExecuteOptions = {},
  ): Promise<T> {
    const call = this.logCallStart('call', plsql, binds);
    const conn = await this.getPool().getConnection();
    this.configureConnection(conn);
    await this.clearEbsSessionLabels(conn);
    try {
      const result = await conn.execute(plsql, binds, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        autoCommit: true,
        ...options,
      });
      const outBinds = (result.outBinds as T) ?? ({} as T);
      const outKeys = Object.keys(outBinds as object);
      this.logCallSuccess(call, {
        summary: `out={ ${outKeys.join(', ')} }`,
        outKeys,
        response: this.captureRawResponse(outBinds),
      });
      return outBinds;
    } catch (err) {
      throw this.logCallError(call, err);
    } finally {
      await this.safeClose(conn);
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
    const call = this.logCallStart('callCursor', plsql, binds);
    const conn = await this.getPool().getConnection();
    this.configureConnection(conn);
    await this.clearEbsSessionLabels(conn);
    try {
      const result = await conn.execute(plsql, binds, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        autoCommit: true,
      });
      const outBinds = (result.outBinds ?? {}) as Record<string, oracledb.ResultSet<T>>;
      const cursor = outBinds[cursorBindName];
      if (!cursor) {
        this.logCallSuccess(call, { summary: 'no cursor', rowCount: 0 });
        return [];
      }
      const rows = (await cursor.getRows(0)) as T[];
      await cursor.close();
      this.logCallSuccess(call, {
        summary: `${rows?.length ?? 0} row(s)`,
        rowCount: rows?.length ?? 0,
        response: this.captureRawResponse(rows ?? []),
      });
      return rows ?? [];
    } catch (err) {
      throw this.logCallError(call, err);
    } finally {
      await this.safeClose(conn);
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
    const call = this.logCallStart('call', plsql, binds);
    const conn = await this.getPool().getConnection();
    this.configureConnection(conn);
    await this.clearEbsSessionLabels(conn);
    try {
      const result = await conn.execute(plsql, binds, {
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
      const rowCounts = Object.fromEntries(Object.entries(cursors).map(([k, v]) => [k, v.length]));
      this.logCallSuccess(call, {
        summary: `cursors={ ${Object.entries(rowCounts)
          .map(([k, n]) => `${k}:${n}`)
          .join(', ')} } scalars={ ${Object.keys(scalars).join(', ')} }`,
        outKeys: Object.keys(outBinds),
        // Full cursor rows + scalar OUT binds — not just the per-cursor row
        // counts — so the diagnostics log holds the complete Oracle response.
        response: this.captureRawResponse({ ...cursors, ...scalars }),
      });
      return { cursors, scalars };
    } catch (err) {
      throw this.logCallError(call, err);
    } finally {
      await this.safeClose(conn);
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
        this.logger.debug(`Cursor ${name} was never opened by the procedure — treating as empty.`);
        return [];
      }
      throw err;
    }
  }

  // ── Oracle call logging ─────────────────────────────────────
  // Every Oracle function call is logged (start + outcome) so failing/hanging
  // calls can be traced to the exact object and (sanitized) binds. Correlated
  // by a per-call id `[ora#N]`.

  private logCallStart(
    op: OracleCallLog['op'],
    sql: string,
    binds: oracledb.BindParameters,
  ): OracleCallLog {
    const id = ++this.callSeq;
    const entry: OracleCallLog = {
      id,
      op,
      label: this.describeSql(sql),
      started: Date.now(),
      sql: this.compactSql(sql),
      binds: this.sanitizeBinds(binds),
    };
    this.logger.log(`[ora#${id}] ${op} → ${entry.label} binds=${this.formatBinds(entry.binds)}`);
    this.logger.debug(`[ora#${id}] SQL: ${entry.sql}`);
    return entry;
  }

  private logCallSuccess(
    entry: OracleCallLog,
    result: { summary: string; rowCount?: number; outKeys?: string[]; response?: unknown },
  ): void {
    const ms = Date.now() - entry.started;
    this.logger.log(`[ora#${entry.id}] ${entry.op} done ${entry.label} ${result.summary} (${ms}ms)`);
    this.recordEntry(entry, ms, {
      status: 'success',
      rowCount: result.rowCount,
      outKeys: result.outKeys,
      response: result.response,
    });
  }

  private logCallError(entry: OracleCallLog, err: unknown): OracleQueryError {
    const ms = Date.now() - entry.started;
    const wrapped = OracleQueryError.from(err);
    const code = wrapped.oraCode ? ` [ORA-${wrapped.oraCode}]` : '';
    this.logger.error(
      `[ora#${entry.id}] ${entry.op} FAILED ${entry.label} after ${ms}ms${code}: ${wrapped.message}`,
    );
    this.recordEntry(entry, ms, {
      status: 'error',
      oraCode: wrapped.oraCode,
      error: wrapped.message,
    });
    return wrapped;
  }

  /** Persist a structured record to the in-memory store served by the diagnostics API. */
  private recordEntry(
    entry: OracleCallLog,
    durationMs: number,
    outcome: {
      status: 'success' | 'error';
      rowCount?: number;
      outKeys?: string[];
      oraCode?: number;
      error?: string;
      response?: unknown;
    },
  ): void {
    const ctx = RequestContext.get();
    this.logStore.record({
      id: entry.id,
      timestamp: new Date().toISOString(),
      op: entry.op,
      object: entry.label,
      status: outcome.status,
      durationMs,
      rowCount: outcome.rowCount,
      outKeys: outcome.outKeys,
      oraCode: outcome.oraCode,
      error: outcome.error,
      correlationId: ctx?.correlationId,
      method: ctx?.method,
      path: ctx?.path,
      binds: entry.binds,
      sql: entry.sql,
      finalSql: this.buildFinalSql(entry.sql, entry.binds),
      response: outcome.response,
    });
  }

  /**
   * Substitute each `:bind` in the SQL with its (sanitized) value so the log
   * shows the statement as Oracle effectively receives it. Names are replaced
   * longest-first and only when not followed by another identifier char, so
   * `:p_attachment1` never clobbers `:p_attachment10`. Values are rendered by
   * `toSqlLiteral` (strings single-quoted, NULL/OUT markers preserved). This is
   * a readability aid built from redacted binds — not the literal wire text.
   */
  private buildFinalSql(sql: string, binds: Record<string, string>): string {
    let out = sql;
    const names = Object.keys(binds).sort((a, b) => b.length - a.length);
    for (const name of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const token = new RegExp(`:${escaped}(?![A-Za-z0-9_$])`, 'g');
      out = out.replace(token, () => this.toSqlLiteral(binds[name]));
    }
    return out;
  }

  /** Render a sanitized bind value as an Oracle literal for `buildFinalSql`. */
  private toSqlLiteral(value: string): string {
    if (value === 'null' || value === 'undefined') return 'NULL';
    // OUT / INOUT markers are not input literals — keep them as-is so the
    // direction is still visible in the rendered statement.
    if (value === '<OUT>' || value.startsWith('<INOUT ')) return value;
    return `'${value.replace(/'/g, "''")}'`;
  }

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
  private captureRawResponse(value: unknown, seen = new WeakSet<object>()): unknown {
    if (value === null || value === undefined || typeof value !== 'object') return value;
    if (Buffer.isBuffer(value)) return `[Buffer ${value.length} byte(s)]`;
    if (value instanceof Date) return value.toISOString();
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.map((v) => this.captureRawResponse(v, seen));
    const ctor = (value as { constructor?: { name?: string } }).constructor;
    if (ctor && ctor !== Object) return `[${ctor.name}]`;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = this.captureRawResponse(v, seen);
    }
    return out;
  }

  /** Short label for a statement: the view/table read or the procedure invoked. */
  private describeSql(sql: string): string {
    const compact = this.compactSql(sql);
    const from = /\bfrom\s+([a-z0-9_$.]+)/i.exec(compact);
    if (from) return from[1].toUpperCase();
    const proc = /\b(?:begin\s+)?([a-z0-9_$]+(?:\.[a-z0-9_$]+)?)\s*\(/i.exec(compact);
    if (proc) return proc[1].toUpperCase();
    return compact.length > 60 ? `${compact.slice(0, 57)}...` : compact;
  }

  private compactSql(sql: string): string {
    return sql.replace(/\s+/g, ' ').trim();
  }

  /** Produce a loggable, safe key→value map: OUT binds as `<OUT>`, secrets redacted. */
  private sanitizeBinds(binds: oracledb.BindParameters): Record<string, string> {
    const record = (binds ?? {}) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
      out[key] = this.formatBindValue(key, value);
    }
    return out;
  }

  /** Render a sanitized bind map as `{ k=v, ... }` for the console line. */
  private formatBinds(binds: Record<string, string>): string {
    const keys = Object.keys(binds);
    if (keys.length === 0) return '{}';
    return `{ ${keys.map((k) => `${k}=${binds[k]}`).join(', ')} }`;
  }

  private formatBindValue(key: string, value: unknown): string {
    if (OracleService.SENSITIVE_BIND.test(key)) return '***';
    if (value !== null && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
      const v = value as Record<string, unknown>;
      if ('dir' in v) {
        if (v.dir === oracledb.BIND_OUT) return '<OUT>';
        if (v.dir === oracledb.BIND_INOUT) return `<INOUT ${this.formatScalar(v.val)}>`;
        return this.formatScalar(v.val);
      }
      // A typed IN bind (`{ type, val }`, no `dir`) — e.g. the DATE/BLOB/NUMBER
      // conversions done by BaseOracleRepository.inBind / LeaveApplyBinds.
      // Render the actual value, not the descriptor: dumping the raw
      // `{ type: { num, name, ... }, val }` object as JSON previously produced
      // unreadable noise (and looked like a malformed literal) in the SQL log.
      if ('val' in v) return this.formatScalar(v.val);
    }
    return this.formatScalar(value);
  }

  private formatScalar(value: unknown): string {
    if (value === null || value === undefined) return String(value);
    // Dates only ever appear here via our own DATE/TIMESTAMP bind conversion
    // (see parseOracleDate) — render as an explicit TO_DATE(...) literal so
    // the logged SQL is actually valid/readable, not `{"type":{...},...}`.
    if (value instanceof Date) return `TO_DATE('${value.toISOString().slice(0, 10)}', 'YYYY-MM-DD')`;
    if (Buffer.isBuffer(value)) return `<BLOB ${value.length} byte(s)>`;
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    return s.length > 120 ? `${s.slice(0, 117)}...` : s;
  }

  /** Lightweight readiness check for the /health endpoint. */
  async ping(): Promise<boolean> {
    if (!this.pool) return false;
    const conn = await this.pool.getConnection();
    try {
      await conn.execute('SELECT 1 FROM DUAL');
      return true;
    } finally {
      await this.safeClose(conn);
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
    if (!this.pool) {
      diag.error = {
        message:
          !this.cfg.user || !this.cfg.dsn
            ? 'Oracle credentials/DSN missing — pool not initialized.'
            : ERROR_MESSAGES.ORACLE_UNAVAILABLE,
      };
      return diag;
    }

    const start = Date.now();
    let conn: oracledb.Connection | undefined;
    try {
      conn = await this.pool.getConnection();
      const result = await conn.execute<{ DB_TIME: string }>(
        "SELECT TO_CHAR(SYSTIMESTAMP, 'YYYY-MM-DD\"T\"HH24:MI:SS.FF3TZH:TZM') AS DB_TIME FROM DUAL",
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
      diag.latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      diag.error = { message, oraCode: extractOraCode(message) };
    } finally {
      if (conn) await this.safeClose(conn);
      diag.pool = {
        connectionsOpen: this.pool.connectionsOpen,
        connectionsInUse: this.pool.connectionsInUse,
      };
    }
    return diag;
  }

  private configureConnection(conn: oracledb.Connection): void {
    conn.callTimeout = this.cfg.callTimeout;
  }

  private async safeClose(conn: oracledb.Connection): Promise<void> {
    try {
      await conn.close();
    } catch (err) {
      this.logger.error(`Error closing Oracle connection: ${(err as Error).message}`);
    }
  }
}
