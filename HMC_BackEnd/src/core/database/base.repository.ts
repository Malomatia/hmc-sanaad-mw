import { Logger, NotImplementedException } from '@nestjs/common';
import * as oracledb from 'oracledb';
import { OracleService } from './oracle.service';
import { OracleSchemaService, ProcedureParam } from './oracle-schema.service';
import { SubmitResult } from '@shared/domain/submit-result';
import { safeDecodeUri } from '@shared/utils/url-decode.util';
import { parseOracleDate } from '@shared/utils/date.util';
import { toBlobBuffer } from '@shared/utils/blob.util';
import { ERROR_MESSAGES, extractOraCode } from '@shared/constants/error-codes';
import { EMP_KEY_COLUMN, USERNAME_COLUMN } from '@shared/constants/oracle-columns';
import {
  CATEGORY_MESSAGE,
  ErrorCategory,
  extractBusinessRaiseText,
  looksSensitive,
} from '../http/error-category';
import { SchemaColumnNotFoundException } from './schema-column-not-found.error';
import { RequestContext } from '../http/request-context';

/**
 * Base class for Oracle adapters. Centralizes the OUT-bind conventions
 * (`p_status` / `p_message`) so every `_PR`/`_PKG` call maps to a uniform
 * SubmitResult. Concrete repositories extend this and inject OracleService.
 *
 * See Docs_Ai/Repository Pattern/README.md (Recommendations).
 */
/** Extra rendering rules for `callSubmitProc`. */
export interface SubmitProcOptions {
  /**
   * Parameters to pass through a PL/SQL function instead of binding directly:
   * `{ p_phone_type: 'XXHMC_SND_PHONE_PKG.str_to_type' }` renders
   * `p_phone_type => XXHMC_SND_PHONE_PKG.str_to_type(:p_phone_type)`.
   *
   * Needed when a formal is a PL/SQL collection type (an associative array such
   * as `XXHMC_SND_PHONE_PKG.ETSND_VARCHAR`) that the package itself knows how
   * to build from a delimited string. Binding those formals directly produced
   * an EMPTY collection, which the phone package reported as the misleading
   * business error "Phone type doesnot exist" for every value — the type was
   * never the problem, the empty array was.
   */
  wrap?: Record<string, string>;
}

export abstract class BaseOracleRepository {
  /** Named after the concrete subclass so log lines identify the adapter. */
  private readonly logger = new Logger(this.constructor.name);

  /**
   * `schema` is optional: adapters that read views whose key column is not
   * certain, or that call procedures whose OUT contract is not certain, inject it
   * and use `readByResolvedKey` / `callSubmitProc`; the rest keep the
   * single-argument constructor.
   */
  constructor(
    protected readonly ora: OracleService,
    protected readonly schema?: OracleSchemaService,
  ) {}

  /** Parameterized SELECT against a view/LOV (Pattern A). */
  protected query<T = Record<string, any>>(
    sql: string,
    binds: oracledb.BindParameters = {},
  ): Promise<T[]> {
    return this.ora.query<T>(sql, binds);
  }

  /** Anonymous PL/SQL block for `_PR`/`_PKG` with OUT binds (Pattern B/C). */
  protected call<T = Record<string, any>>(
    plsql: string,
    binds: oracledb.BindParameters,
    options: oracledb.ExecuteOptions = {},
  ): Promise<T> {
    return this.ora.call<T>(plsql, binds, options);
  }

  /** PL/SQL returning a REF CURSOR read into an array. */
  protected callCursor<T = Record<string, any>>(
    plsql: string,
    binds: oracledb.BindParameters,
    cursorBindName = 'cursor',
  ): Promise<T[]> {
    return this.ora.callCursor<T>(plsql, binds, cursorBindName);
  }

  /**
   * SELECT from a table function — a `FUNCTION ... RETURN <collection type>`
   * (e.g. `XXHMC_SND_SUPERVISOR_VIEW`, confirmed by Oracle as
   * `FUNCTION(p_user_name, p_limit_txt) RETURN xxhmc_snd_emp_dets_nt`).
   * Neither `SELECT * FROM object WHERE ...` (`ORA-04044`: it's not a table)
   * nor `BEGIN object(...); END;` (`PLS-00221`: it's not a procedure) work —
   * table functions are queried via `SELECT * FROM TABLE(fn(...))`, and the
   * `TABLE(...)` call syntax is positional only (no `=>` named-argument
   * notation), so `args` must be supplied in the function's declared order.
   *
   * `maxRows` caps the result with `ROWNUM` at the database (rather than
   * fetching everything and truncating client-side): one call unexpectedly
   * returned 31,000+ rows — not something any client should ever receive in
   * one response, and large enough that some downstream JSON serialization
   * step could exhaust the call stack. Default is generous but bounded.
   *
   * `containsFilter` adds a case-insensitive `LIKE '%value%'` on one of the
   * collection's columns, applied in the same WHERE — i.e. BEFORE the ROWNUM
   * cap, so a search matches the full row set, not just the first `maxRows`
   * rows. The column name comes from the calling repository (a code constant,
   * never user input); only the value is bound.
   */
  protected queryTableFunction<T = Record<string, any>>(
    object: string,
    args: readonly unknown[],
    maxRows = 2000,
    containsFilter?: { column: string; value: string },
  ): Promise<T[]> {
    const binds: oracledb.BindParameters = { maxRows };
    const placeholders = args.map((value, i) => {
      const name = `arg${i}`;
      (binds as Record<string, unknown>)[name] = value;
      return `:${name}`;
    });
    const conditions: string[] = [];
    if (containsFilter?.value.trim()) {
      (binds as Record<string, unknown>).filterValue =
        `%${containsFilter.value.trim().toUpperCase()}%`;
      conditions.push(`UPPER(${containsFilter.column}) LIKE :filterValue`);
    }
    conditions.push('ROWNUM <= :maxRows');
    return this.query<T>(
      `SELECT * FROM TABLE(${object}(${placeholders.join(', ')})) WHERE ${conditions.join(' AND ')}`,
      binds,
    );
  }

  /** SELECT all rows from an employee-scoped view (Pattern A). */
  protected readByEmployee<T = Record<string, any>>(
    object: string,
    employeeNumber: string,
    keyColumn: string = EMP_KEY_COLUMN,
  ): Promise<T[]> {
    return this.query<T>(`SELECT * FROM ${object} WHERE ${keyColumn} = :enum`, {
      enum: employeeNumber,
    });
  }

  /** SELECT all rows from a username-scoped view/LOV (Pattern A). */
  protected readByUsername<T = Record<string, any>>(
    object: string,
    username: string,
    keyColumn: string = USERNAME_COLUMN,
  ): Promise<T[]> {
    return this.query<T>(`SELECT * FROM ${object} WHERE ${keyColumn} = :u`, { u: username });
  }

  /**
   * SELECT from a view filtered on whichever of `candidates` the view really
   * exposes (see OracleSchemaService). Use this instead of guessing between
   * documented request-parameter names such as USER_NAME vs EMPLOYEE_NUMBER.
   *
   * A schema mismatch (none of the candidates exist on `object`) is NOT
   * allowed to fail the request: it's logged as a SCHEMA_MISMATCH warning
   * (with the view, missing/available columns and calling repository) and
   * this read degrades to an empty result, so the rest of the response —
   * built from whichever OTHER reads/views succeeded — is still returned as
   * HTTP 200. Any other failure (connectivity, permissions, timeouts, real
   * SQL errors) is untouched and still propagates to the global handler.
   */
  protected async readByResolvedKey<T = Record<string, any>>(
    object: string,
    value: string,
    candidates: readonly string[],
  ): Promise<T[]> {
    return this.readByResolvedKeyAny<T>(object, [value], candidates);
  }

  /**
   * Same as `readByResolvedKey` but matches ANY of several identifier forms:
   * `WHERE <key> IN (:k0, :k1)`.
   *
   * Needed because the same logical person is stored differently across the
   * approvals views — `APPROVE_SUMRY_V`/`MY_REQEST_SUMMARY_V` hold the employee
   * NUMBER (`037400`) while `PNDNG_QID_V` holds the login (`AIBRAHIM39`), and a
   * single response is built from both. Passing the caller's username AND
   * employee number makes each view match on whichever form it happens to use,
   * instead of forcing the mobile client to guess per endpoint.
   */
  protected async readByResolvedKeyAny<T = Record<string, any>>(
    object: string,
    values: readonly (string | undefined)[],
    candidates: readonly string[],
  ): Promise<T[]> {
    if (!this.schema) {
      throw new Error(
        `${this.constructor.name} must inject OracleSchemaService to use readByResolvedKey.`,
      );
    }
    const distinct = [...new Set(values.filter((v): v is string => !!v && v.trim() !== ''))];
    if (!distinct.length) return [];
    try {
      const keyColumn = await this.schema.resolveKeyColumn(object, candidates);
      const binds = Object.fromEntries(distinct.map((v, i) => [`k${i}`, v]));
      const placeholders = distinct.map((_, i) => `:k${i}`).join(', ');
      return await this.query<T>(
        `SELECT * FROM ${object} WHERE ${keyColumn} IN (${placeholders})`,
        binds,
      );
    } catch (err) {
      if (err instanceof SchemaColumnNotFoundException) {
        this.logSchemaMismatch(err);
        return [];
      }
      throw err;
    }
  }

  /**
   * SELECT rows whose resolved key column is IN `values` (parameterized,
   * chunked at Oracle's 1000-item IN-list limit). Returns [] without a round
   * trip when `values` is empty, and degrades to [] on a schema mismatch —
   * same contract as `readByResolvedKey`. Used for child rows keyed by IDs
   * gathered from a parent view (e.g. dependent phones/addresses keyed by the
   * DEPENDENT_ID / ADDRESS_ID values of the EMP_CONTACT_V dependents).
   */
  protected async readByResolvedKeyIn<T = Record<string, any>>(
    object: string,
    values: readonly (string | undefined)[],
    candidates: readonly string[],
  ): Promise<T[]> {
    if (!this.schema) {
      throw new Error(
        `${this.constructor.name} must inject OracleSchemaService to use readByResolvedKeyIn.`,
      );
    }
    const unique = [...new Set(values.filter((v): v is string => !!v))];
    if (!unique.length) return [];
    try {
      const keyColumn = await this.schema.resolveKeyColumn(object, candidates);
      const chunks: string[][] = [];
      for (let i = 0; i < unique.length; i += 1000) chunks.push(unique.slice(i, i + 1000));
      const rows = await Promise.all(
        chunks.map((chunk) => {
          const binds: oracledb.BindParameters = {};
          const placeholders = chunk.map((value, i) => {
            (binds as Record<string, unknown>)[`k${i}`] = value;
            return `:k${i}`;
          });
          return this.query<T>(
            `SELECT * FROM ${object} WHERE ${keyColumn} IN (${placeholders.join(', ')})`,
            binds,
          );
        }),
      );
      return rows.flat();
    } catch (err) {
      if (err instanceof SchemaColumnNotFoundException) {
        this.logSchemaMismatch(err);
        return [];
      }
      throw err;
    }
  }

  /** Structured, internal-only WARNING for a caught schema mismatch (never a fatal error). */
  private logSchemaMismatch(err: SchemaColumnNotFoundException): void {
    const requestId = RequestContext.get()?.correlationId ?? '-';
    this.logger.warn(
      `[SCHEMA_MISMATCH] requestId=${requestId} repository=${this.constructor.name} ` +
        `object=${err.object} missingCandidates=[${err.candidates.join(', ')}] ` +
        `availableColumns=[${err.availableColumns.join(', ')}] — degrading to an empty result ` +
        `instead of failing the request.`,
      err.stack,
    );
  }

  /**
   * Marks an adapter whose exact Oracle bind signature is not yet captured
   * (see Docs_Ai known gaps). Throws 501 until implemented.
   */
  protected notImplemented(object: string): never {
    throw new NotImplementedException(`${ERROR_MESSAGES.NOT_IMPLEMENTED} [${object}]`);
  }

  /**
   * Call a submit-style `_PR`/`_PKG` procedure and map its OUT binds to a
   * SubmitResult.
   *
   * The argument list is taken from the data dictionary when it is readable, so
   * the call always matches what the database declares — both the IN parameters
   * and the OUT contract, which the Sanaad request-input tables do not list. That
   * matters because the OUT names are not uniform (`p_status` / `p_message` for
   * the phone package, `p_success_flag` / `p_error_msg` / `p_error_msg_ar` for
   * REASSIGN_PR), and a named argument the procedure does not declare raises
   * `PLS-00306: wrong number or types of arguments`.
   *
   * When the dictionary is unavailable it falls back to the documented `params`
   * plus `outBinds`. Every parameter is always bound (NULL when absent from
   * `values`) so the full argument list is satisfied.
   */
  protected async callSubmitProc(
    object: string,
    params: readonly string[],
    values: Record<string, unknown>,
    outBinds: oracledb.BindParameters = this.statusOutBinds(),
    options: SubmitProcOptions = {},
  ): Promise<SubmitResult> {
    const declared = await this.schema?.resolveParams(object, params);
    const wrap = options.wrap ?? {};
    const binds: oracledb.BindParameters = {};
    const names: string[] = [];

    if (declared?.length) {
      for (const param of declared) {
        names.push(param.name);
        if (param.direction.includes('OUT')) {
          (binds as Record<string, unknown>)[param.name] = BaseOracleRepository.outBind(
            param,
            BaseOracleRepository.pick(values, param.name),
          );
          continue;
        }
        if (
          !param.defaulted &&
          !BaseOracleRepository.hasValue(values, param.name) &&
          !BaseOracleRepository.isExpected(params, param.name)
        ) {
          // The dictionary declares a parameter the mapping does not know. Keep
          // the call alive (NULL bind, the legacy services do the same) but
          // surface the drift so the documented param list gets updated.
          this.logger.warn(`Unmapped Oracle parameter ${object}.${param.name} bound as NULL`);
        }
        if (wrap[param.name]) {
          // Rendered as `p_x => PKG.fn(:p_x)`: the value is bound as a plain
          // string and the PL/SQL function builds the composite the formal
          // actually declares (see SubmitProcOptions.wrap).
          (binds as Record<string, unknown>)[param.name] = BaseOracleRepository.pick(
            values,
            param.name,
          );
          continue;
        }
        (binds as Record<string, unknown>)[param.name] = BaseOracleRepository.inBind(
          param,
          BaseOracleRepository.pick(values, param.name),
        );
      }
    } else {
      Object.assign(binds, outBinds);
      names.push(...params, ...Object.keys(outBinds));
      for (const p of params) {
        (binds as Record<string, unknown>)[p] = BaseOracleRepository.pick(values, p);
      }
    }

    const namedArgs = names
      .map((n) => (wrap[n] ? `${n} => ${wrap[n]}(:${n})` : `${n} => :${n}`))
      .join(',\n          ');
    const out = await this.call<Record<string, any>>(
      `BEGIN ${object}(\n          ${namedArgs}); END;`,
      binds,
    );
    return this.toSubmitResult(out);
  }

  /**
   * Call a procedure that returns its rows through a REF CURSOR (leave balance,
   * child details). Like `callSubmitProc` the argument list comes from the data
   * dictionary when it is readable — including the real name of the cursor
   * parameter, which differs between procedures — and falls back to the
   * documented `params` plus `cursorParam` otherwise.
   */
  protected async callRowsProc<T = Record<string, any>>(
    object: string,
    params: readonly string[],
    values: Record<string, unknown>,
    cursorParam = 'p_cursor',
  ): Promise<T[]> {
    const declared = await this.schema?.resolveParams(object, params);

    if (declared?.length) {
      const binds: oracledb.BindParameters = {};
      const names: string[] = [];
      let cursorName = cursorParam;
      for (const param of declared) {
        names.push(param.name);
        const isCursor =
          param.direction.includes('OUT') && param.dataType.toUpperCase() === 'REF CURSOR';
        if (isCursor) {
          // The row set. Bind it under its real formal name and tell callCursor
          // which OUT bind to read.
          cursorName = param.name;
          (binds as Record<string, unknown>)[param.name] = {
            dir: oracledb.BIND_OUT,
            type: oracledb.CURSOR,
          };
          continue;
        }
        if (param.direction.includes('OUT')) {
          // A scalar OUT the procedure also declares (e.g. GET_PAYSLIP_PERIODS'
          // p_success_flag / p_error_msg). It must be bound or the call is short
          // an argument — PLS-00306. Its value is unused here.
          (binds as Record<string, unknown>)[param.name] = BaseOracleRepository.outBind(
            param,
            BaseOracleRepository.pick(values, param.name),
          );
          continue;
        }
        (binds as Record<string, unknown>)[param.name] = BaseOracleRepository.inBind(
          param,
          BaseOracleRepository.pick(values, param.name),
        );
      }
      const namedArgs = names.map((n) => `${n} => :${n}`).join(',\n          ');
      return this.callCursor<T>(`BEGIN ${object}(\n          ${namedArgs}); END;`, binds, cursorName);
    }

    const inParams = [...params];
    const binds: oracledb.BindParameters = { ...this.cursorOutBind() };
    for (const p of inParams) {
      (binds as Record<string, unknown>)[p] = BaseOracleRepository.pick(values, p);
    }
    const namedArgs = [...inParams.map((p) => `${p} => :${p}`), `${cursorParam} => :cursor`].join(
      ',\n          ',
    );
    return this.callCursor<T>(`BEGIN ${object}(\n          ${namedArgs}); END;`, binds);
  }

  /**
   * Read a program unit that may be EITHER a `_PR`/`_PKG` procedure returning
   * a REF CURSOR (Pattern C, handled by `callRowsProc`) OR a table function —
   * a `FUNCTION ... RETURN <collection type>` such as
   * `XXHMC_SND_CHILD_DETS_VIEW` (confirmed by Oracle as
   * `FUNCTION(p_acad_yr_strt_dt, p_user_name) RETURN xxhmc_snd_child_detl_nt`).
   * Calling a function with `BEGIN object(...); END;` raises
   * `PLS-00221: is not a procedure or is undefined`; it must be queried with
   * `SELECT * FROM TABLE(fn(...))` instead (see `queryTableFunction`), and
   * that call syntax is positional only, so the resolved formal parameters —
   * in their declared order — decide the argument order, not `params`.
   *
   * The data dictionary is consulted first so the two shapes are told apart
   * automatically; when it can't be read, this falls back to the
   * REF-CURSOR-procedure assumption via `callRowsProc`.
   */
  protected async callRowsOrTableFunction<T = Record<string, any>>(
    object: string,
    params: readonly string[],
    values: Record<string, unknown>,
    cursorParam = 'p_cursor',
  ): Promise<T[]> {
    const signature = this.schema ? await this.schema.resolveSignature(object, params) : undefined;
    if (signature?.returnType) {
      const args = signature.params.map((param) =>
        BaseOracleRepository.pick(values, param.name),
      );
      return this.queryTableFunction<T>(object, args);
    }
    return this.callRowsProc<T>(object, params, values, cursorParam);
  }

  /**
   * Call a procedure that returns MULTIPLE REF CURSORs in a single round trip
   * (e.g. PAYSLIP_PR: 7 separate cursors — earnings/deductions/totals/
   * balances/informations/net payments/housing — plus scalar OUT params).
   *
   * `callRowsProc` only tracks the *last* REF CURSOR it sees (one row set per
   * call); binding every cursor that way but reading only one back with
   * `callCursor` leaves the others open and can surface as
   * `NJS-107: invalid cursor` / `ORA-24338: statement handle not executed`.
   * This reads every declared REF CURSOR OUT bind into its own array, keyed by
   * its formal parameter name, plus every scalar OUT bind's raw value.
   *
   * Like `callRowsProc`/`callSubmitProc`, the argument list comes from the data
   * dictionary when readable and falls back to the documented `params` /
   * `cursorParams` / `scalarOutParams` otherwise.
   */
  protected async callMultiCursorProc(
    object: string,
    params: readonly string[],
    values: Record<string, unknown>,
    cursorParams: readonly string[],
    scalarOutParams: readonly string[] = [],
  ): Promise<{ cursors: Record<string, Record<string, any>[]>; scalars: Record<string, any> }> {
    const declared = await this.schema?.resolveParams(object, [
      ...params,
      ...cursorParams,
      ...scalarOutParams,
    ]);
    const binds: oracledb.BindParameters = {};
    const names: string[] = [];
    const cursorNames: string[] = [];

    if (declared?.length) {
      for (const param of declared) {
        names.push(param.name);
        const isCursor =
          param.direction.includes('OUT') && param.dataType.toUpperCase() === 'REF CURSOR';
        if (isCursor) {
          cursorNames.push(param.name);
          (binds as Record<string, unknown>)[param.name] = { dir: oracledb.BIND_OUT, type: oracledb.CURSOR };
          continue;
        }
        if (param.direction.includes('OUT')) {
          (binds as Record<string, unknown>)[param.name] = BaseOracleRepository.outBind(
            param,
            BaseOracleRepository.pick(values, param.name),
          );
          continue;
        }
        (binds as Record<string, unknown>)[param.name] = BaseOracleRepository.inBind(
          param,
          BaseOracleRepository.pick(values, param.name),
        );
      }
    } else {
      for (const p of params) {
        (binds as Record<string, unknown>)[p] = BaseOracleRepository.pick(values, p);
        names.push(p);
      }
      for (const c of cursorParams) {
        (binds as Record<string, unknown>)[c] = { dir: oracledb.BIND_OUT, type: oracledb.CURSOR };
        names.push(c);
        cursorNames.push(c);
      }
      for (const s of scalarOutParams) {
        (binds as Record<string, unknown>)[s] = {
          dir: oracledb.BIND_OUT,
          type: oracledb.STRING,
          maxSize: 4000,
        };
        names.push(s);
      }
    }

    const namedArgs = names.map((n) => `${n} => :${n}`).join(',\n          ');
    // Not this.call(): a REF CURSOR ResultSet is tied to its connection, and
    // call() releases the connection before returning — fetching from any of
    // these cursors afterward would throw NJS-018 (invalid ResultSet).
    // callMultiCursor reads (and closes) every cursor itself, before its own
    // connection-release.
    return this.ora.callMultiCursor(
      `BEGIN ${object}(\n          ${namedArgs}); END;`,
      binds,
      cursorNames,
    );
  }

  /**
   * Value for a formal parameter, tolerating the `p_` prefix being present on one
   * side only: the Sanaad mapping documents some inputs bare (`PERSON_ID`,
   * `PERIOD`) and others prefixed (`P_USER_NAME`), while the declared parameter
   * name comes from the database. Returns null so the argument is still bound.
   */
  private static pick(values: Record<string, unknown>, param: string): unknown {
    const bare = param.replace(/^p_/, '');
    return values[param] ?? values[bare] ?? values[`p_${bare}`] ?? null;
  }

  /** First value that is non-null/undefined AND non-blank once trimmed to a string. */
  private static firstNonEmpty(...values: unknown[]): string {
    for (const v of values) {
      const s = (v ?? '').toString().trim();
      if (s) return s;
    }
    return '';
  }

  private static hasValue(values: Record<string, unknown>, param: string): boolean {
    const bare = param.replace(/^p_/, '');
    return [param, bare, `p_${bare}`].some((key) => Object.prototype.hasOwnProperty.call(values, key));
  }

  private static isExpected(params: readonly string[], param: string): boolean {
    const bare = param.replace(/^p_/, '');
    return params.some((candidate) => candidate.replace(/^p_/, '') === bare);
  }

  private static inBind(param: ProcedureParam, value: unknown): unknown {
    const type = OracleSchemaService.outBindType(param);
    // Attachments (p_attachmentN) are declared BLOB but arrive as base64 text;
    // a VARCHAR bind to a BLOB formal is a type mismatch → PLS-00306. Convert to
    // binary so node-oracledb binds an actual LOB.
    if (type === oracledb.DB_TYPE_BLOB) {
      return { type, val: toBlobBuffer(value) };
    }
    // DATE/TIMESTAMP formals arrive as request strings in whatever format the
    // caller used (`YYYYMMDD`, `YYYY-MM-DD`, `DD-MON-YYYY`, ...). Binding the
    // raw string leaves node-oracledb to bind it as VARCHAR2 and Oracle to
    // parse it against the session's NLS_DATE_FORMAT, which raised
    // ORA-01861 (`literal does not match format string`) and, for genuinely
    // unparseable input, ORA-01858. Parsing to a real JS `Date` here makes
    // node-oracledb bind it natively, bypassing NLS parsing entirely.
    if (type === oracledb.DB_TYPE_DATE || type === oracledb.DB_TYPE_TIMESTAMP) {
      return { type, val: parseOracleDate(value) };
    }
    return typeof type === 'string' ? { type, val: value } : value;
  }

  private static outBind(param: ProcedureParam, value: unknown): oracledb.BindParameter {
    const type = OracleSchemaService.outBindType(param);
    const dir = param.direction.includes('IN') ? oracledb.BIND_INOUT : oracledb.BIND_OUT;
    return type === oracledb.DB_TYPE_VARCHAR
      ? { dir, type, maxSize: 4000, ...(dir === oracledb.BIND_INOUT ? { val: value } : {}) }
      : { dir, type, ...(dir === oracledb.BIND_INOUT ? { val: value } : {}) };
  }

  /** `p_file_name1..N` / `p_attachment1..N` slot names shared by submit procs. */
  static attachmentParams(n = 10): string[] {
    const slots: string[] = [];
    for (let i = 1; i <= n; i++) slots.push(`p_file_name${i}`, `p_attachment${i}`);
    return slots;
  }

  /**
   * Standard OUT binds for a status flag + message returned by `_PR`
   * procedures — used as the fallback in `callSubmitProc` when the data
   * dictionary can't be read. `p_success_flag` was added as a third OUT param
   * across all submit procedures; omitting it raises `PLS-00306: wrong number
   * or types of arguments` now that the procedures declare it.
   */
  protected statusOutBinds(): oracledb.BindParameters {
    return {
      p_status: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 10 },
      p_message: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 4000 },
      p_success_flag: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 2500 },
    };
  }

  /**
   * OUT binds for procedures that report `p_success_flag` + bilingual error
   * messages (documented signature of REASSIGN_PR: `..., p_success_flag,
   * p_error_msg, p_error_msg_ar`).
   */
  protected successFlagOutBinds(): oracledb.BindParameters {
    return {
      p_success_flag: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 2500 },
      p_error_msg: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 2500 },
      p_error_msg_ar: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 2500 },
    };
  }

  /** A REF CURSOR OUT bind (default name `cursor`). */
  protected cursorOutBind(): oracledb.BindParameters {
    return { cursor: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR } };
  }

  /**
   * Map common OUT-bind shapes to a SubmitResult. Accepts `{ p_status,
   * p_message }`, `{ p_success_flag, p_error_msg, p_error_msg_ar }` or
   * `{ status, msg }` style out binds.
   */
  protected toSubmitResult(out: Record<string, any>): SubmitResult {
    // `p_status` is now bound alongside `p_success_flag` on every submit proc
    // (see statusOutBinds); prefer whichever one actually came back non-empty
    // instead of a plain `??` chain, which would get stuck on an empty string
    // from a bound-but-unused param.
    const flagRaw = BaseOracleRepository.firstNonEmpty(
      out.p_success_flag,
      out.p_status,
      out.status,
      out.successflag,
    );
    const message = (out.p_message ?? out.p_error_msg ?? out.msg ?? out.errormessage ?? '').toString();
    const messageAr = out.p_message_ar ?? out.p_error_msg_ar ?? out.errormessage_ar;
    // Different procedures use different success conventions: 'S' (status),
    // 'Y' (p_success_flag, e.g. REASSIGN_PR-style: p_success_flag/p_error_msg/
    // p_error_msg_ar — { p_success_flag: "Y", p_error_msg: null, ... } is success),
    // or '0'.
    const flagUpper = flagRaw.toUpperCase();
    const isSuccess = flagUpper === 'S' || flagUpper === 'Y' || flagRaw === '0';
    // Some procedures (e.g. APPROVE_REJECT_PR) leave every OUT bind — flag AND
    // message — unset when the row they were asked to act on doesn't exist or
    // was already processed, instead of setting p_success_flag = 'N' with an
    // explanation. That used to fall through to the generic "Operation failed"
    // below, which reads as if the call itself broke rather than "there was
    // nothing to do". Give that specific, ambiguous case its own message.
    const noSignalAtAll = !flagRaw && !message;
    let errormessage =
      message ||
      (isSuccess
        ? 'Success'
        : noSignalAtAll
          ? 'No matching record was found for this request, or it has already been processed.'
          : 'Operation failed');
    let safeMessageAr = messageAr ? safeDecodeUri(messageAr) : undefined;

    // This channel (op result, HTTP 200) bypasses the exception filter, so an
    // Oracle proc surfacing an ORA-/PLS- error or SQL text in p_message must be
    // sanitized here too — never forward technical detail to the client.
    // A failed submit (p_success_flag/p_status = 'N') always comes back as an
    // error result, never a silent success — and a custom ORA-20xxx raise (a
    // business-rule validation, e.g. "FLEX-VALUE DOES NOT EXIST") surfaces its
    // own raise text when that text is clean (it is authored as user-facing
    // validation), falling back to the generic business-rule message otherwise —
    // matching how the same ORA range is classified for thrown exceptions
    // (see exception-classifier.ts).
    if (!isSuccess && looksSensitive(errormessage)) {
      const oraCode = extractOraCode(errormessage);
      const isBusinessRaise = oraCode !== undefined && oraCode >= 20000 && oraCode <= 20999;
      const category = isBusinessRaise
        ? ErrorCategory.BUSINESS_RULE_ERROR
        : ErrorCategory.DATABASE_ERROR;
      const raiseText = isBusinessRaise ? extractBusinessRaiseText(errormessage) : undefined;
      this.logger.warn(
        `Suppressed technical proc message (${category}${oraCode ? ` ORA-${oraCode}` : ''}): ${errormessage}`,
      );
      errormessage = raiseText ?? CATEGORY_MESSAGE[category];
      safeMessageAr = undefined;
    }

    return {
      successflag: isSuccess ? 'S' : 'N',
      status: isSuccess ? 'success' : 'error',
      errormessage,
      errormessageAr: safeMessageAr,
    };
  }
}
