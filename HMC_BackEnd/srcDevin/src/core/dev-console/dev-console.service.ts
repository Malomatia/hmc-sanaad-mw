import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import oracledb = require('oracledb');
import { AppConfig, DevConsoleConfig, OracleConfig } from '../config/configuration';
import { extractOraCode } from '@shared/constants/error-codes';
import { OracleLogStore } from '../database/oracle-log.store';
import { OracleService } from '../database/oracle.service';

/** Result of one worksheet statement. Never throws for SQL errors — they are data. */
export interface SqlExecResult {
  ok: boolean;
  kind: StatementKind;
  elapsedMs: number;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  /** True when `rows` was cut at maxRows. */
  truncated: boolean;
  /** OUT binds of a PL/SQL block. */
  outBinds?: Record<string, unknown>;
  /** Rows affected by DML. */
  rowsAffected?: number;
  error?: {
    message: string;
    oraCode?: number;
    /** Character offset Oracle reported for a syntax error. */
    offset?: number;
    /** ORA-06512 backtrace lines: which program unit + line actually raised. */
    stack: { unit: string; line: number }[];
    hint?: string;
  };
}

export type StatementKind = 'query' | 'plsql' | 'dml' | 'ddl' | 'explain' | 'unknown';

const READ_ONLY_KINDS: StatementKind[] = ['query', 'explain'];

/** Statements that are never allowed, even with DEV_CONSOLE_ALLOW_WRITE=true. */
const FORBIDDEN = /\b(shutdown|startup|drop\s+(database|tablespace|user)|alter\s+(database|system)|grant|revoke|truncate\s+table\s+(fnd_|per_|hr\.))/i;

/** Common ORA codes we can explain in one line inside the console. */
const ORA_HINTS: Record<number, string> = {
  1: 'Unique constraint violated — the row already exists (check the constraint name in the message).',
  27: 'The procedure ran ALTER SYSTEM KILL SESSION against its own session — a broken exception handler inside the PL/SQL, not a caller problem.',
  904: 'Invalid identifier — the column does not exist on that view/table. Use the Objects panel to list the real columns.',
  942: 'Table or view does not exist (or no grant on it for this schema).',
  1403: 'NO_DATA_FOUND raised inside PL/SQL — a SELECT INTO found no row. Open the source at the ORA-06512 line to see which one.',
  1407: 'Cannot update a NOT NULL column to NULL — a required parameter was not supplied to the procedure.',
  1422: 'Exact fetch returned more than one row — a SELECT INTO matched several rows.',
  1722: 'Invalid number — a non-numeric string was passed where the PL/SQL expects a number.',
  3156: 'Call timeout: the statement exceeded the configured call timeout (cold cache / missing index / full scan).',
  6502: 'PL/SQL numeric or value error (usually "character string buffer too small") — a local variable is shorter than the value assigned.',
  6550: 'PL/SQL compilation error in the anonymous block — wrong parameter count/types (see PLS-00306) or unknown identifier.',
  20001: 'Application-raised error (RAISE_APPLICATION_ERROR) — read the text: it is usually a flexfield/value-set validation.',
  24338: 'Statement handle not executed — a REF CURSOR OUT bind was never OPENed by the procedure on this code path.',
};

/**
 * Backend of the internal developer console.
 *
 * Purpose: reproduce, from the running app, exactly what a DBA would do in a
 * SQL worksheet — run a statement, read the real ORA error with its backtrace,
 * open the PL/SQL source at the failing line, and inspect the object's columns
 * and formal parameters. It uses its OWN Oracle connection (its own timeout,
 * and a ROLLBACK for read-only statements) so it can never interfere with
 * application traffic.
 */
@Injectable()
export class DevConsoleService {
  private readonly logger = new Logger(DevConsoleService.name);
  private readonly cfg: DevConsoleConfig;
  private readonly oracleCfg: OracleConfig;
  private readonly app: AppConfig;
  /**
   * Write mode is runtime state, not configuration: the console ships
   * read-only and the operator flips this from the UI when they actually need
   * to run a procedure or a DML. In memory only — every restart returns to the
   * safe default, so a forgotten switch cannot persist.
   */
  private writeMode: boolean;

  constructor(
    config: ConfigService,
    private readonly logStore: OracleLogStore,
    private readonly ora: OracleService,
  ) {
    this.cfg = config.getOrThrow<DevConsoleConfig>('devConsole');
    this.oracleCfg = config.getOrThrow<OracleConfig>('oracle');
    this.app = config.getOrThrow<AppConfig>('app');
    this.writeMode = this.cfg.allowWrite;
  }

  settings() {
    return {
      allowWrite: this.writeMode,
      writeModeIsRuntime: true,
      maxRows: this.cfg.maxRows,
      timeoutMs: this.cfg.timeoutMs,
      oracle: {
        disabled: this.oracleCfg.disabled,
        user: this.oracleCfg.user || '(not set)',
        dsn: this.oracleCfg.dsn || '(not set)',
      },
      apiBaseUrl: `/${this.app.apiPrefix}`,
    };
  }

  /** Flip write mode for this process. Logged loudly — it lets statements commit. */
  setWriteMode(on: boolean) {
    this.writeMode = on;
    if (on) {
      this.logger.warn(
        'DEV CONSOLE: WRITE MODE ENABLED — DML/DDL/PL-SQL will now execute and commit. ' +
          'Resets to read-only on restart.',
      );
    } else {
      this.logger.log('DEV CONSOLE: back to read-only mode.');
    }
    return this.settings();
  }

  // ── SQL execution ───────────────────────────────────────────

  /** Classify a statement so read-only mode and result handling can be decided. */
  classify(sql: string): StatementKind {
    const s = sql.trim().replace(/^--.*$/gm, '').trim().toLowerCase();
    if (!s) return 'unknown';
    if (s.startsWith('select') || s.startsWith('with')) return 'query';
    if (s.startsWith('explain plan')) return 'explain';
    if (s.startsWith('begin') || s.startsWith('declare')) return 'plsql';
    if (/^(insert|update|delete|merge|commit|rollback)\b/.test(s)) return 'dml';
    if (/^(create|alter|drop|truncate|grant|revoke)\b/.test(s)) return 'ddl';
    return 'unknown';
  }

  async execute(input: {
    sql?: string;
    binds?: Record<string, unknown>;
    maxRows?: number;
  }): Promise<SqlExecResult> {
    const sql = this.prepare(input.sql ?? '');
    const kind = this.classify(sql);
    const maxRows = Math.min(input.maxRows ?? this.cfg.maxRows, this.cfg.maxRows);

    if (FORBIDDEN.test(sql)) {
      throw new BadRequestException('This statement class is blocked by the console.');
    }
    if (!this.writeMode && !READ_ONLY_KINDS.includes(kind)) {
      throw new BadRequestException(
        `Read-only console: ${kind.toUpperCase()} statements need write mode. ` +
          'Click the READ-ONLY badge in the header to switch. SELECT / WITH / EXPLAIN PLAN always run.',
      );
    }
    if (this.oracleCfg.disabled) {
      throw new BadRequestException('ORACLE_DISABLED=true — no pool to run statements against.');
    }

    const started = Date.now();
    let conn: oracledb.Connection | undefined;
    try {
      conn = await this.ora.acquire(this.cfg.timeoutMs);
      const result = await conn.execute(sql, (input.binds ?? {}) as oracledb.BindParameters, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        // Read-only statements never commit; writes commit only while the
        // operator has write mode switched on.
        autoCommit: this.writeMode && !READ_ONLY_KINDS.includes(kind),
        maxRows: maxRows + 1,
      });

      const all = (result.rows as Record<string, unknown>[]) ?? [];
      const truncated = all.length > maxRows;
      const rows = truncated ? all.slice(0, maxRows) : all;
      if (READ_ONLY_KINDS.includes(kind)) await conn.rollback().catch(() => undefined);

      return {
        ok: true,
        kind,
        elapsedMs: Date.now() - started,
        columns: (result.metaData ?? []).map((m) => m.name),
        rows: rows.map((r) => this.serializeRow(r)),
        rowCount: rows.length,
        truncated,
        outBinds: result.outBinds ? (this.serializeRow(result.outBinds as Record<string, unknown>)) : undefined,
        rowsAffected: result.rowsAffected,
      };
    } catch (err) {
      return {
        ok: false,
        kind,
        elapsedMs: Date.now() - started,
        columns: [],
        rows: [],
        rowCount: 0,
        truncated: false,
        error: this.describeError(err),
      };
    } finally {
      if (conn) await conn.close().catch(() => undefined);
    }
  }

  /** Trim and drop a single trailing `;` for plain SQL (PL/SQL keeps its terminator). */
  private prepare(raw: string): string {
    const sql = (raw ?? '').trim();
    if (!sql) throw new BadRequestException('Empty statement.');
    const kind = this.classify(sql);
    if (kind === 'plsql') return sql.replace(/;\s*\/\s*$/, ';');
    return sql.replace(/;+\s*$/, '');
  }

  /**
   * Turn an Oracle driver error into the full picture a DBA needs: message,
   * ORA code, the ORA-06512 backtrace (which program unit and LINE raised it)
   * and a one-line hint. The backtrace is what makes "open the source at the
   * failing line" possible from the UI.
   */
  private describeError(err: unknown): NonNullable<SqlExecResult['error']> {
    const e = err as { message?: string; errorNum?: number; offset?: number };
    const message = e?.message ?? String(err);
    const oraCode = e?.errorNum ?? extractOraCode(message);
    const stack: { unit: string; line: number }[] = [];
    const re = /ORA-06512:\s*at\s*(?:"([^"]+)"|line)\s*,?\s*line\s*(\d+)/gi;
    for (let m = re.exec(message); m; m = re.exec(message)) {
      stack.push({ unit: m[1] ?? '(anonymous block)', line: Number(m[2]) });
    }
    return {
      message,
      oraCode,
      offset: e?.offset,
      stack,
      hint: oraCode ? ORA_HINTS[oraCode] : undefined,
    };
  }

  /** JSON-safe row: Buffers described, Dates ISO, LOB/driver objects named. */
  private serializeRow(row: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row ?? {})) out[k] = this.serializeValue(v);
    return out;
  }

  private serializeValue(v: unknown): unknown {
    if (v === null || v === undefined) return null;
    if (Buffer.isBuffer(v)) return `[BLOB ${v.length} bytes]`;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object') {
      const ctor = (v as { constructor?: { name?: string } }).constructor;
      if (ctor && ctor !== Object && ctor !== Array) return `[${ctor.name}]`;
      if (Array.isArray(v)) return v.map((x) => this.serializeValue(x));
      return this.serializeRow(v as Record<string, unknown>);
    }
    return v;
  }

  // ── Data-dictionary browsing (no allow-list: this is the DBA view) ──

  /** Navigator: objects matching a search, grouped by type. */
  async objects(search = '', type = ''): Promise<Record<string, unknown>[]> {
    const like = `%${(search || 'XXHMC_SND').toUpperCase()}%`;
    return this.readOnly(
      `SELECT owner, object_name, object_type, status,
              TO_CHAR(last_ddl_time, 'YYYY-MM-DD HH24:MI') last_ddl
         FROM all_objects
        WHERE object_name LIKE :like
          AND (:type IS NULL OR object_type = :type)
          AND object_type IN ('TABLE','VIEW','PACKAGE','PACKAGE BODY','PROCEDURE','FUNCTION','SYNONYM','TYPE','MATERIALIZED VIEW')
        ORDER BY DECODE(object_type,'VIEW',1,'PROCEDURE',2,'PACKAGE',3,'FUNCTION',4,5), object_name
        FETCH FIRST 300 ROWS ONLY`,
      { like, type: type || null },
    );
  }

  /** Columns + formal arguments + compilation errors of one object. */
  async describe(name: string) {
    const object = (name ?? '').trim().toUpperCase();
    if (!object) throw new BadRequestException('Object name is required.');
    const [pkg, member] = object.split('.');
    const [kinds, columns, args, errors] = await Promise.all([
      this.readOnly(
        `SELECT owner, object_name, object_type, status,
                TO_CHAR(last_ddl_time,'YYYY-MM-DD HH24:MI') last_ddl
           FROM all_objects WHERE object_name IN (:pkg, :member) ORDER BY object_name, object_type`,
        { pkg, member: member ?? pkg },
      ),
      this.readOnly(
        `SELECT column_name, data_type, data_length, nullable, column_id
           FROM all_tab_columns WHERE table_name = :pkg ORDER BY column_id`,
        { pkg },
      ),
      this.readOnly(
        `SELECT owner, package_name, object_name, overload, subprogram_id, argument_name,
                position, sequence, data_level, data_type, in_out, defaulted, type_name
           FROM all_arguments
          WHERE (:member IS NOT NULL AND package_name = :pkg AND object_name = :member)
             OR (:member IS NULL AND package_name IS NULL AND object_name = :pkg)
          ORDER BY owner, subprogram_id, overload NULLS FIRST, sequence`,
        { pkg, member: member ?? null },
      ),
      this.readOnly(
        `SELECT owner, name, type, line, position, text
           FROM all_errors WHERE name IN (:pkg, :member) ORDER BY sequence`,
        { pkg, member: member ?? pkg },
      ),
    ]);
    return { object, kinds, columns, arguments: args, errors };
  }

  /**
   * PL/SQL source with line numbers — the whole point of the console: when a
   * procedure fails with "ORA-06512: at "APPS.XXHMC_SND_SCHOOL_FEE_PR", line
   * 197", open that unit around line 197 and read the statement that raised.
   */
  async source(name: string, line?: number, around = 40) {
    const object = (name ?? '').trim().toUpperCase();
    if (!object) throw new BadRequestException('Object name is required.');
    const unit = object.includes('.') ? object.split('.')[0] : object;
    const rows = await this.readOnly(
      `SELECT owner, name, type, line, text FROM all_source
        WHERE name = :unit ORDER BY owner, type, line`,
      { unit },
    );
    if (!line) return { object: unit, total: rows.length, from: 1, to: rows.length, lines: rows };
    const from = Math.max(1, line - around);
    const to = line + around;
    return {
      object: unit,
      total: rows.length,
      from,
      to,
      focusLine: line,
      lines: rows.filter((r) => Number(r.LINE) >= from && Number(r.LINE) <= to),
    };
  }

  /** EXPLAIN PLAN for a SELECT, rendered by DBMS_XPLAN. */
  async explain(sql: string) {
    const statement = this.prepare(sql);
    if (this.classify(statement) !== 'query') {
      throw new BadRequestException('EXPLAIN PLAN is only available for SELECT/WITH statements.');
    }
    const id = `devconsole_${Date.now()}`;
    await this.execRaw(`EXPLAIN PLAN SET STATEMENT_ID = '${id}' FOR ${statement}`, {});
    const rows = await this.readOnly(
      `SELECT plan_table_output FROM TABLE(DBMS_XPLAN.DISPLAY('PLAN_TABLE', :id, 'ALL'))`,
      { id },
    );
    return { statementId: id, plan: rows.map((r) => String(r.PLAN_TABLE_OUTPUT ?? '')) };
  }

  /** Internal helper: run a dictionary read on a dedicated connection. */
  private async readOnly(sql: string, binds: oracledb.BindParameters): Promise<Record<string, unknown>[]> {
    const res = await this.execRaw(sql, binds);
    return ((res.rows as Record<string, unknown>[]) ?? []).map((r) => this.serializeRow(r));
  }

  private async execRaw(sql: string, binds: oracledb.BindParameters): Promise<oracledb.Result<unknown>> {
    if (this.oracleCfg.disabled) {
      throw new BadRequestException('ORACLE_DISABLED=true — no pool to run statements against.');
    }
    const conn = await this.ora.acquire(this.cfg.timeoutMs);
    try {
      return await conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT, maxRows: 2000 });
    } finally {
      await conn.close().catch(() => undefined);
    }
  }

  // ── API tester (calls this app, then shows the Oracle calls it produced) ──

  /**
   * Fire any endpoint of this backend from the console and return the HTTP
   * response TOGETHER WITH every Oracle call it triggered (SQL, binds, OUT
   * values, ORA errors). That linkage — request → procedures → failing line —
   * is what the diagnostics log alone cannot show in one place.
   */
  async callApi(input: {
    method: string;
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  }) {
    const method = (input.method || 'GET').toUpperCase();
    const path = input.path.startsWith('/') ? input.path : `/${input.path}`;
    const url = `http://127.0.0.1:${this.app.port}${path.startsWith(`/${this.app.apiPrefix}`) ? path : `/${this.app.apiPrefix}${path}`}`;

    // Everything logged after this id belongs to the call we are about to make.
    const before = this.logStore.list({ limit: 1, order: 'desc' }).items[0]?.id ?? 0;
    const started = Date.now();
    let status = 0;
    let bodyText = '';
    let error: string | undefined;
    try {
      const res = await fetch(url, {
        method,
        headers: {
          ...(input.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(input.headers ?? {}),
        },
        body: input.body !== undefined && method !== 'GET' ? JSON.stringify(input.body) : undefined,
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
      status = res.status;
      bodyText = await res.text();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    let parsed: unknown = bodyText;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      /* keep raw text */
    }

    const oracleCalls = this.logStore
      .list({ limit: 200, order: 'desc' })
      .items.filter((e) => e.id > before)
      .reverse();

    return {
      request: { method, url, body: input.body },
      response: { status, body: parsed, error, elapsedMs: Date.now() - started },
      oracleCalls,
    };
  }
}
